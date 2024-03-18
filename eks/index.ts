import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as fs from 'fs';
import * as path from 'path';

const stack = pulumi.getStack();
const prefix = stack;

const vpcStack = new pulumi.StackReference(`codefly/network/${stack}`);

const vpcId = vpcStack.getOutput("vpcId");
const publicSubnetIds = vpcStack.getOutput("publicSubnetIds");
const privateSubnetIds = vpcStack.getOutput("privateSubnetIds");

const clusterName = `${prefix}-cluster`;

// Create an EKS cluster.
const cluster = new eks.Cluster(`${prefix}-cluster`, {
    name: clusterName,
    instanceType: "t3a.medium",
    desiredCapacity: 3,
    minSize: 1,
    maxSize: 5,
    vpcId: vpcId,
    publicSubnetIds: publicSubnetIds,
    privateSubnetIds: privateSubnetIds,
    nodeAssociatePublicIpAddress: false,
    createOidcProvider: true,
});


export const oidcUrl = cluster.core.oidcProvider?.url;

if (!oidcUrl) {
    throw new Error("Unable to get OIDC URL");
}

// Example: Creating an IAM role for the AWS Load Balancer Controller
const iamRole = new aws.iam.Role("loadBalancerControllerRole", {
    name: `loadBalancerControllerRole-${prefix}`,
    assumeRolePolicy: pulumi.all([aws.getCallerIdentity(), oidcUrl]).apply(([callerIdentity, url]) => `{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Federated": "arn:aws:iam::${callerIdentity.accountId}:oidc-provider/${url}"},
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "${url}:sub": "system:serviceaccount:kube-system:aws-load-balancer-controller"
                }
            }
        }]
    }`),
}, { dependsOn: [cluster] });

const policyDocument = fs.readFileSync(path.resolve(__dirname, 'iam_policy.json'), 'utf-8');

const loadBalancerControllerPolicy = new aws.iam.Policy("AWSLoadBalancerControllerIAMPolicy", {
    policy: policyDocument,
});

const loadBalancerControllerPolicyAttachment = new aws.iam.RolePolicyAttachment("loadBalancerControllerPolicyAttachment", {
    role: iamRole.name,
    policyArn: loadBalancerControllerPolicy.arn,
});

const loadBalancerControllerServiceAccount = new k8s.core.v1.ServiceAccount("aws-load-balancer-controller", {
    metadata: {
        namespace: "kube-system",
        name: "aws-load-balancer-controller",
        annotations: {
            "eks.amazonaws.com/role-arn": iamRole.arn,
        },
    },
}, { provider: cluster.provider });

const albControllerChart = new k8s.helm.v3.Chart("aws-load-balancer-controller", {
    chart: "aws-load-balancer-controller",
    version: "1.7.1", // Specify the version you wish to use
    namespace: "kube-system",
    fetchOpts: {
        repo: "https://aws.github.io/eks-charts",
    },
    values: {
        clusterName: cluster.eksCluster.name,
        serviceAccount: {
            create: false,
            name: "aws-load-balancer-controller",
        },
        // Add additional configuration if needed
    },
}, { provider: cluster.provider, dependsOn: [loadBalancerControllerServiceAccount] });

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;