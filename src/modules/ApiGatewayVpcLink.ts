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
        const nlb = new aws.lb.LoadBalancer(`${this.config.project}-${name}-apigw-nlb`, {
            name: `${this.config.generalPrefix}-${name}-apigw-nlb`,
            internal: true,
            loadBalancerType: "network",
            enableCrossZoneLoadBalancing: true,
            subnets: vpc.privateSubnetIds,
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

        // const nlbArnSuffix = nlb.arn.apply(arn => arn.split("/").pop()!);

        // const nlbPrivateIps = vpc.apply(x => {
        //     return pulumi.all(x.privateSubnetIds).apply()
        // })

        // const nlbPrivateIps = vpc.privateSubnetIds.apply(x => {
        //     return pulumi.all(x).apply(subnetIds => {
        //         const result = subnetIds.map(subnetId =>
        //             nlbArnSuffix.apply(suffix =>
        //                 aws.ec2.getNetworkInterface({
        //                     filters: [
        //                         {
        //                             name: "description",
        //                             values: [`ELB ${suffix}`],
        //                         },
        //                         {
        //                             name: "subnet-id",
        //                             values: [subnetId],
        //                         },
        //                     ],
        //                 }, {async: true}).then(eni => eni.privateIp)
        //             )
        //         );
        //
        //         console.log(result)
        //
        //         return result
        //     })
        // });

        return {
            nlb,
            vpcLink
        } as ApiGatewayVpcLinkResult
    }
}

export {ApiGatewayVpcLink}
