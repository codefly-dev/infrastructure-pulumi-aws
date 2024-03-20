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

// Fetch the ACM certificate by domain name (it handles wildcards subdomains)
const certificate = aws.acm.getCertificate({domain: domain}, {async: true});
export const certificateArn = certificate.then(cert => cert.arn);

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


// TODO: is there a Pulumi way to do this?

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
        credentialName: "istio-local-ssl-cert-secret"
      hosts:
      - "*"
`;


const istioGateway = new k8s.yaml.ConfigGroup("istio-gateway", {
    yaml: istioGatewayYaml,
}, {provider: provider, dependsOn: [ingressGateway,istioSslCertSecret ]});
