/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export type AlbResult = {
    alb: pulumi.Output<awsx.classic.lb.ApplicationLoadBalancer>;
    securityGroup: pulumi.Output<awsx.classic.ec2.SecurityGroup>;
    vpc: pulumi.Output<awsx.classic.ec2.Vpc>;
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
    protocol: string;  // e.g., "HTTP", "HTTPS", "TCP"
    port: number;
};
