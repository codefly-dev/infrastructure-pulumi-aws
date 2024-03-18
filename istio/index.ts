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


// Kiali Installation

// Prometheus and Grafana Installation
const prometheusRelease = new k8s.helm.v3.Release("prometheus", {
    chart: "prometheus",
    version: "25.17.0",
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    namespace: "istio-system",
    values: {
        alertmanager: {
            enabled: false,
        },
        server: {
            persistentVolume: {
                enabled: false
            }
        }
    }
}, {provider: provider, dependsOn: [istiod]});

const grafanaRelease = new k8s.helm.v3.Release("grafana", {
    chart: "grafana",
    version: "7.3.7",
    repositoryOpts: {
        repo: "https://grafana.github.io/helm-charts",
    },
    namespace: "istio-system",
    values: {
        grafanaIni: {
            auth: {
                anonymous: {
                    enabled: true
                }
            }
        },
        service: {
            type: "ClusterIP",
        },
    },
}, {provider:provider, dependsOn: [istiod]});

const kiali = new k8s.helm.v3.Chart("kiali", {
    chart: "kiali-server",
    version: "1.81.0",
    namespace: "istio-system",
    fetchOpts: {
        repo: "https://kiali.org/helm-charts",
    },
    values: {
        // Specify your values here, for example:
        auth: {
            strategy: "anonymous",
        },
    },
}, { provider: provider, dependsOn: [grafanaRelease] });

