# AWS EKS + ALB with Pulumi

## Requirements

- [Pulumi](https://www.pulumi.com/docs/get-started/install/)
- AWS Certificate Manager (ACM) certificate

## Setup

- change your domain in `common/index.ts`

## ALB

`pulumi up` in this order:

- network
- eks
- istio
- kiali
- istio-ingress-alb