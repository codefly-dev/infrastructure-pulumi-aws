import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as aws from "@pulumi/aws";
import * as fs from 'fs';
import * as path from 'path';
import {domain, domains} from "../common/naming";

const stack = pulumi.getStack();
// Reference other stacks
const networkStack = new pulumi.StackReference(`codefly/network/${stack}`);

const clusterRef = new pulumi.StackReference(`codefly/eks/${stack}`);
// Hosted zone
const hostedZone = networkStack.getOutput("hostedZone");

// Get the kubeconfig from the referenced stack
const kubeconfig = clusterRef.getOutput("kubeconfig");

// Create a new Kubernetes provider using the kubeconfig from the referenced stack
const provider = new k8s.Provider("provider", {kubeconfig: kubeconfig});

const repoUrl = "https://istio-release.storage.googleapis.com/charts";
const version = "1.20.3";

// Define your SSL certificate and key by hand

// Define the path to the files
const certPath = path.join(__dirname, 'script', 'istio.crt');
const keyPath = path.join(__dirname, 'script', 'istio.key');

// Read the files
const certValue = fs.readFileSync(certPath, 'utf8');
const keyValue = fs.readFileSync(keyPath, 'utf8');

const istioSslCertSecret = new k8s.core.v1.Secret("istio-local-ssl-cert-secret", {
    metadata: {
        name: "istio-local-ssl-cert-secret",
        namespace: "istio-system",
    },
    type: "kubernetes.io/tls",
    stringData: {
        "tls.crt": certValue,
        "tls.key": keyValue,
    },
}, {provider: provider});
//
//  cert-manager

// Create the IAM role
// const certRole = new aws.iam.Role("cert-role", {
//     assumeRolePolicy: JSON.stringify({
//         Version: "2012-10-17",
//         Statement: [
//             {
//                 Action: "sts:AssumeRole",
//                 Principal: {
//                     Service: "ec2.amazonaws.com"
//                 },
//                 Effect: "Allow",
//                 Sid: ""
//             }
//         ]
//     })
// });
//
// // Attach the policy to the role
// const dnsRolePolicy = new aws.iam.RolePolicy("dnsRolePolicy", {
//     role: certRole.id,
//     policy: JSON.stringify({
//         Version: "2012-10-17",
//         Statement: [
//             {
//                 Effect: "Allow",
//                 Action: "route53:GetChange",
//                 Resource: "arn:aws:route53:::change/*"
//             },
//             {
//                 Effect: "Allow",
//                 Action: [
//                     "route53:ChangeResourceRecordSets",
//                     "route53:ListResourceRecordSets"
//                 ],
//                 Resource: `arn:aws:route53:::hostedzone/${hostedZone.apply(hz => hz.id)}`
//             },
//             {
//                 Effect: "Allow",
//                 Action: "route53:ListHostedZonesByName",
//                 Resource: "*"
//             }
//         ]
//     })
// }, );
//
// const certManagerNamespace = new k8s.core.v1.Namespace("cert-manager", {
//     metadata: {
//         name: "cert-manager"
//     }
// }, {provider: provider});
//
// const certManager = new k8s.helm.v3.Chart("cert-manager", {
//     chart: "cert-manager",
//     version: "v1.14.4",
//     namespace: "cert-manager",
//     fetchOpts: {
//         repo: "https://charts.jetstack.io",
//     },
//     values: {
//         installCRDs: true,
//     },
// }, {provider: provider, dependsOn: [certManagerNamespace]});
//
// // Create a ClusterIssuer for Let's Encrypt
// const letsEncryptClusterIssuer = new k8s.apiextensions.CustomResource("letsencrypt", {
//     apiVersion: "cert-manager.io/v1",
//     kind: "ClusterIssuer",
//     metadata: {
//         name: "letsencrypt",
//     },
//     spec: {
//         acme: {
//             server: "https://acme-v02.api.letsencrypt.org/directory",
//             email: "antoine.toussaint@codefly.ai",
//             privateKeySecretRef: {
//                 name: "letsencrypt",
//             },
//             solvers: [
//                 {
//                     dns01: {
//                         route53: {
//                             region: "us-east-1",
//                             role: certRole.arn,
//                         }
//                     }
//                 }
//             ],
//         },
//     },
// }, {provider: provider, dependsOn: [certManager, certRole]});
//
// const istioCert = new k8s.apiextensions.CustomResource("istio-gateway-certificate", {
//     apiVersion: "cert-manager.io/v1",
//     kind: "Certificate",
//     metadata: {
//         name: "istio-gateway-certificate",
//         namespace: "istio-system",
//     },
//     spec: {
//         secretName: "istio-gateway-ssl-certificate",
//         issuerRef: {
//             name: "letsencrypt",
//             kind: "ClusterIssuer",
//         },
//         dnsNames: [
//             domain,
//             domains,
//         ],
//     },
// }, {provider: provider, dependsOn: [letsEncryptClusterIssuer]});


// Fetch the ACM certificate by domain name (it handles wildcards subdomains)
const certificate = aws.acm.getCertificate({domain: domain}, {async: true});
export const certificateArn = certificate.then(cert => cert.arn);

// Name of the release will override the name of the istio ingress gateway service!
// Import to keep it the standard name: "istio-ingressgateway"
const ingressGateway = new k8s.helm.v3.Chart("istio-ingressgateway", {
    chart: "gateway",
    version: version,
    namespace: "istio-system",
    fetchOpts: {
        repo: repoUrl,
    },
    values: {
        // Specify the Helm values for the gateway
        service: {
            type: "NodePort",
        },
    },
}, {provider: provider});

export const loadBalancerName = `load-balancer-${stack}`

// Create an Ingress to create the ALB with target the istio ingress gateway
const ingress = new k8s.networking.v1.Ingress("istio-ingress", {
    metadata: {
        name: "ingress",
        namespace: "istio-system",
        annotations: {
            "kubernetes.io/ingress.class": "alb",
            "alb.ingress.kubernetes.io/scheme": "internet-facing",
            "alb.ingress.kubernetes.io/target-type": "ip",
            "alb.ingress.kubernetes.io/healthcheck-path": "/healthz/ready",
            "alb.ingress.kubernetes.io/healthcheck-port": "status-port",
            "alb.ingress.kubernetes.io/healthcheck-protocol": "HTTP",
            "alb.ingress.kubernetes.io/backend-protocol": "HTTPS",
            "alb.ingress.kubernetes.io/listen-ports": '[{"HTTPS":443}]',
            "alb.ingress.kubernetes.io/certificate-arn": certificateArn,
            "alb.ingress.kubernetes.io/load-balancer-name": `${loadBalancerName}`,
        },
    },
    spec: {
        rules: [
            {
                http: {
                    paths: [
                        {
                            path: "/",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: "istio-ingressgateway",
                                    port: {
                                        number: 443,
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        ],
    },
}, {provider: provider, dependsOn: [ingressGateway]});

// Istio Gateway defines the ingress gateway for the mesh
// It handles SSL termination



const istioGatewayYaml = `
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
    app: istio-ingressgateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: "istio-gateway-ssl-certificate"
      hosts:
      - "*"
`;


const istioGateway = new k8s.yaml.ConfigGroup("istio-gateway", {
    yaml: istioGatewayYaml,
}, {provider: provider, dependsOn: [ingressGateway,istioSslCertSecret ]});
