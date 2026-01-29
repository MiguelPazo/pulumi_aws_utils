/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CertificatesResult} from "./base";
import {VpcImportResult} from "./vpc";
import {VpceDnsOutput} from "./stack";

export type ApiGatewayResult = {
    api: aws.apigateway.RestApi;
    stage: aws.apigateway.Stage;
};

export type ApiGatewayModuleConfig = {
    name: string;
    isPrivate: boolean;
    stageName: string;
    template?: string;
    certificates?: CertificatesResult[];
    logLevel?: string;
    enableLogs?: boolean;
    logGroupKmsKey?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
    enableXRay?: boolean;
    privateVpcEndpointIds?: pulumi.Output<string>[];
    ignoreOpenApiChanges?: boolean;
    dependsOn?: any[];
    vpceApiGwDns?: pulumi.Output<VpceDnsOutput>;
    vpc?: pulumi.Output<VpcImportResult>;
};

export type ApiGatewayVpcLinkResult = {
    nlb: aws.lb.LoadBalancer;
    vpcLink: aws.apigateway.VpcLink;
    securityGroup: aws.ec2.SecurityGroup;
};