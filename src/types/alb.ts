/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {VpcImportResult} from "./vpc";
import {CertificatesResult, PhzResult} from "./base";

export type AlbResult = {
    alb: aws.lb.LoadBalancer;
    securityGroup: aws.ec2.SecurityGroup;
    vpc: pulumi.Output<VpcImportResult>;
};

export type LBConfig = {
    lstPort: number;
    lstProtocol: string;
    tgProtocol: string;
    tgPort: number;
    tgTargetType: string;
    tgHealthCheck: LBHealthCheck;
    tgStickinessEnabled?: boolean;
    tgCookieDuration?: number;
};

export type LBHealthCheck = {
    healthyThreshold: number;
    interval: number;
    path: string;
    timeout: number;
    unhealthyThreshold: number;
    matcher: string;
    protocol?: string;  // e.g., "HTTP", "HTTPS", "TCP"
    port?: number;
};

export type AlbModuleConfig = {
    name: string;
    vpc: pulumi.Output<VpcImportResult>;
    s3Logs?: pulumi.Output<aws.s3.Bucket>;
    internal?: boolean;
    certificate?: CertificatesResult;
    domain?: string;
    createRoute53Record?: boolean;
    phz?: pulumi.Output<PhzResult>;
    createDefaultListener?: boolean;
};

export type AlbListenerModuleConfig = {
    name: string;
    alb: AlbResult;
    certificate: CertificatesResult;
    lbConfig: LBConfig;
    hostHeaderRules?: { host: string; priority: number }[];
    createRoute53Record?: boolean;
    targetIps?: string[];
};
