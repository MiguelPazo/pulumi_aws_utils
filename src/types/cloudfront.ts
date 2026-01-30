/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CertificatesResult, CloudFrontBaseResult} from "./base";

export type CloudFrontFrontendModuleConfig = {
    name: string;
    aliasDns: string[];
    cfbase: pulumi.Output<CloudFrontBaseResult>;
    s3Logs: pulumi.Output<aws.s3.Bucket>;
    certificate: CertificatesResult;
    waf: pulumi.Output<aws.wafv2.WebAcl>;
    customErrorResponses?: aws.types.input.cloudfront.DistributionCustomErrorResponse[];
    dnsRoute53?: string;
};

export type CloudFrontBackendModuleConfig = {
    name: string;
    aliasDns: string[];
    vpcOriginId: pulumi.Output<string>;
    vpcOriginDns: pulumi.Output<string>;
    vpcOriginPath: string;
    apigw: pulumi.Output<aws.apigateway.RestApi>;
    cfbase: pulumi.Output<CloudFrontBaseResult>;
    s3Logs: pulumi.Output<aws.s3.Bucket>;
    certificate: CertificatesResult;
    waf: pulumi.Output<aws.wafv2.WebAcl>;
    dnsRoute53?: string;
};
