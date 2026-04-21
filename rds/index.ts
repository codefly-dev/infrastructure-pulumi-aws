import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";


const stack = pulumi.getStack();

const vpcStack = new pulumi.StackReference(`codefly/network/${stack}`);

const vpcId = vpcStack.getOutput("vpcId");
const privateSubnetIds = vpcStack.getOutput("privateSubnetIds");


// Create a security group that allows incoming PostgreSQL connections
const securityGroup = new aws.ec2.SecurityGroup("securityGroup", {
    vpcId: vpcId,
});

const ingressRule = new aws.ec2.SecurityGroupRule("ingressRule", {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
    securityGroupId: securityGroup.id,
});

// Create a DB subnet group
const dbSubnetGroup = new aws.rds.SubnetGroup(`dbSubnetGroup`, {
    name: "dbsubnetgroup",
    subnetIds: privateSubnetIds,
});

// Create an RDS instance
const db = new aws.rds.Instance("db", {
    engine: "postgres",
    instanceClass: "db.t2.micro",
    allocatedStorage: 20,
    dbName: "visitors",
    username: "postgres",
    password: "yoursecurepassword", // replace with your actual password
    vpcSecurityGroupIds: [securityGroup.id],
    dbSubnetGroupName: dbSubnetGroup.name,
    skipFinalSnapshot: true,
});