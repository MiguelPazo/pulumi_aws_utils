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

export type TgConfigHealthcheck = {
    path: string;
    healthyThreshold: number;
    unhealthyThreshold: number;
    timeout: number;
    interval: number;
    matcher: string;
    protocol?: string;  // e.g., "HTTP", "HTTPS", "TCP"
    port?: number;
};

export type TgConfig = {
    port: number,
    protocol: string,
    targetType: string,
    healthCheck: TgConfigHealthcheck,
    stickinessEnabled?: boolean,
    cookieDuration?: number,
};