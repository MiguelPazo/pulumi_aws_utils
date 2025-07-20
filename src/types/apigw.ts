/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export type ApiGatewayVpcLinkResult = {
    nlb: aws.lb.LoadBalancer;
    vpcLink: aws.apigateway.VpcLink;
    securityGroup: pulumi.Output<awsx.classic.ec2.SecurityGroup>
};