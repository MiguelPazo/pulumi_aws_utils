/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {ApiGatewayVpcLinkResult, VpcImportResult} from "../types";

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
        vpc: pulumi.Output<VpcImportResult>
    ): Promise<ApiGatewayVpcLinkResult> {
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-${name}-apigw-vpclink-sg`, {
            name: `${this.config.generalPrefixShort}-${name}-apigw-vpclink-sg`,
            description: `${this.config.generalPrefixShort}-${name}-apigw-vpclink-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${name}-apigw-vpclink-sg`,
            },
        });

        new aws.vpc.SecurityGroupEgressRule(`${this.config.project}-${name}-apigw-vpclink-sg-rule-1`, {
            securityGroupId: securityGroup.id,
            description: "Egress to all",
            ipProtocol: aws.ec2.ProtocolType.All,
            fromPort: -1,
            toPort: -1,
            cidrIpv4: "0.0.0.0/0"
        });

        const vpcLink = new aws.apigatewayv2.VpcLink(`${this.config.project}-${name}-apigw-vpclink`, {
            name: `${this.config.generalPrefix}-${name}-apigw-vpclink`,
            securityGroupIds: [securityGroup.id],
            subnetIds: vpc.privateSubnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apigw-vpclink`,
            }
        });

        return {
            vpcLink,
            securityGroup
        } as ApiGatewayVpcLinkResult
    }
}

export {ApiGatewayVpcLink}
