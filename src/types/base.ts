/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {EcsServiceResult} from "./ecs";

export type CloudFrontBaseResult = {
    oac: aws.cloudfront.OriginAccessControl;
    hpFrontend: aws.cloudfront.ResponseHeadersPolicy;
    hpBackend: aws.cloudfront.ResponseHeadersPolicy;
    cpFrontend: aws.cloudfront.CachePolicy;
};

export type CertificatesResult = {
    domain: string;
    arn: string;
    resource: aws.acm.Certificate;
    zoneId: string;
};

export type PhzResult = {
    zone: aws.route53.Zone;
    cert: aws.acm.Certificate;
};

export type Route53Result = {
    domain: string;
    zoneId: string;
    resource: aws.route53.Zone;
};

export type WafResult = {
    wafFrontend: aws.wafv2.WebAcl;
    wafBackend: aws.wafv2.WebAcl;
};

export type EcsServiceInstanceResult = {
    oService: pulumi.Output<EcsServiceResult>;
    securityGroupTask: aws.ec2.SecurityGroup;
};