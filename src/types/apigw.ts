/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type ApiGatewayVpcLinkResult = {
    nlb: aws.lb.LoadBalancer;
    vpcLink: aws.apigateway.VpcLink;
};