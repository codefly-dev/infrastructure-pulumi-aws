import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as aws from "@pulumi/aws";

const stack = pulumi.getStack();

// Reference to another stack
const clusterRef = new pulumi.StackReference(`codefly/eks/${stack}`);

// Get the kubeconfig from the referenced stack
const kubeconfig = clusterRef.getOutput("kubeconfig");

// Create a new Kubernetes provider using the kubeconfig from the referenced stack
const provider = new k8s.Provider("provider", {kubeconfig: kubeconfig});

const istioNamespace = new k8s.core.v1.Namespace("istio-system", {
    metadata: {
        name: "istio-system"
    }
}, {provider: provider});

const repoUrl = "https://istio-release.storage.googleapis.com/charts";
const version = "1.20.3";

// Istio Base Installation
const istio = new k8s.helm.v3.Chart("istio", {
    chart: "base",
    version: version, // Your Istio version
    namespace: "istio-system",
    fetchOpts: {
        repo: repoUrl,
    },
}, {provider: provider});

// Istiod Installation
const istiod = new k8s.helm.v3.Chart("istiod", {
    chart: "istiod", version: version,
    namespace: "istio-system",
    fetchOpts: {
        repo: repoUrl,
    }, // Additional values to customize your Istio installation
}, {provider: provider, dependsOn: [istio]});


// Enable mTLS for the entire mesh
const defaultPeerAuth = new k8s.apiextensions.CustomResource("default-peer-authentication", {
    apiVersion: "security.istio.io/v1beta1",
    kind: "PeerAuthentication",
    metadata: {
        name: "default",
        namespace: "istio-system",
    },
    spec: {
        mtls: {
            mode: "STRICT",
        },
    },
}, {provider: provider, dependsOn: [istiod]});