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

// Kiali Installation

// Prometheus and Grafana Installation
const prometheusRelease = new k8s.helm.v3.Release("prometheus", {
    chart: "prometheus",
    name: "prometheus",
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
}, {provider: provider});

const grafanaRelease = new k8s.helm.v3.Release("grafana", {
    chart: "grafana",
    name: "grafana",
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
}, {provider:provider});

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
        external_services: {
            prometheus: {
                url: "http://prometheus-server.istio-system.svc:80"
            },
            grafana: {
                url: "http://grafana.istio-system.svc:80"
            }
        }
    },
}, { provider: provider, dependsOn: [grafanaRelease, prometheusRelease] });

