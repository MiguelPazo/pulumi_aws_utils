/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import * as awsx from "@pulumi/awsx";
import {ApiGatewayVpcLinkResult} from "../types";

class ApiGatewayVpcLink {
    private static __instance: ApiGatewayVpcLink;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): ApiGatewayVpcLink {
        if (this.__instance == null) {
            this.__instance = new ApiGatewayVpcLink();
        }

        return this.__instance;
    }

    async main(
        name: string,
        vpc: pulumi.Output<awsx.classic.ec2.Vpc>
    ): Promise<ApiGatewayVpcLinkResult> {
        const securityGroup = vpc.apply(x => {
            return new awsx.classic.ec2.SecurityGroup(`${this.config.project}-${name}-apigw-nlb-sg`, {
                description: `${this.config.generalPrefixShort}-${name}-apigw-nlb-sg`,
                vpc: x,
                egress: [{
                    protocol: "-1",
                    fromPort: 0,
                    toPort: 0,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Egress to all"
                }],
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${name}-apigw-nlb-sg`,
                },
            });
        })

        const nlb = new aws.lb.LoadBalancer(`${this.config.project}-${name}-apigw-nlb`, {
            name: `${this.config.generalPrefix}-${name}-apigw-nlb`,
            internal: true,
            loadBalancerType: "network",
            enableCrossZoneLoadBalancing: true,
            subnets: vpc.privateSubnetIds,
            securityGroups: [securityGroup.securityGroup.id],
            enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: "off",
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apigw-nlb`,
            }
        });

        const vpcLink = new aws.apigateway.VpcLink(`${this.config.project}-${name}-apigw-vpclink`, {
            name: `${this.config.generalPrefix}-${name}-apigw-vpclink`,
            description: `${this.config.generalPrefix}-${name}-apigw-vpclink`,
            targetArn: nlb.arn,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apigw-vpclink`,
            }
        });

        return {
            nlb,
            vpcLink,
            securityGroup
        } as ApiGatewayVpcLinkResult
    }
}

export {ApiGatewayVpcLink}
