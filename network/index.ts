import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import {domain} from "../common/naming";

const stack = pulumi.getStack();

// Create a VPC for our cluster.
const vpc = new awsx.ec2.Vpc(`${stack}-vpc`, {
    numberOfAvailabilityZones: 3,
    subnetSpecs: [
        {
            type: awsx.ec2.SubnetType.Public,
            name:`public-subnet`,
            tags: {
                "kubernetes.io/role/elb": "1", // for ELB, ALB
            },
        },
        {
            type: awsx.ec2.SubnetType.Private,
            name: `private-subnet`,
            tags: {
                "kubernetes.io/role/internal-elb": "1", // for internal Load Balancers
            },
        },
    ],
    natGateways: {
        strategy: "Single",
    },
});

// Export a few properties to make them easy to use.
export const vpcId = vpc.vpcId;
export const privateSubnetIds = vpc.privateSubnetIds;
export const publicSubnetIds = vpc.publicSubnetIds;


// Hosted zone export


export const hostedZone = aws.route53.getZone({name: domain}, { async: true });

