/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {TgConfig} from "../types/alb";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import * as awsx from "@pulumi/awsx";
import {CertificatesResult} from "../types";

class NlbListener {
    private static __instance: NlbListener;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): NlbListener {
        if (this.__instance == null) {
            this.__instance = new NlbListener();
        }

        return this.__instance;
    }

    async main(
        name: string,
        nlb: pulumi.Output<aws.lb.LoadBalancer>,
        vpc: pulumi.Output<awsx.classic.ec2.Vpc>,
        lstProtocol: string,
        lstPort: number,
        lstCertificate: CertificatesResult,
        tgConfig: TgConfig
    ): Promise<aws.lb.TargetGroup> {
        const targetGroup = new aws.lb.TargetGroup(`${this.config.project}-${name}-tg`, {
            name: `${this.config.generalPrefixShort}-${name}-tg`,
            vpcId: vpc.vpc.id,
            port: tgConfig.port,
            protocol: tgConfig.protocol.toUpperCase(),
            targetType: tgConfig.targetType,
            deregistrationDelay: 10,
            slowStart: 0,
            proxyProtocolV2: false,
            healthCheck: {
                enabled: true,
                healthyThreshold: tgConfig.healthCheck.healthyThreshold,
                unhealthyThreshold: tgConfig.healthCheck.unhealthyThreshold,
                timeout: tgConfig.healthCheck.timeout,
                interval: tgConfig.healthCheck.interval,
                protocol: tgConfig.healthCheck.protocol,
                port: tgConfig.healthCheck.port.toString(),
                matcher: tgConfig.healthCheck.protocol === "TCP" ? undefined : tgConfig.healthCheck.matcher,
                path: tgConfig.healthCheck.protocol === "TCP" ? undefined : tgConfig.healthCheck.path,
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${name}-tg`,
            }
        });

        lstProtocol = lstProtocol.toUpperCase();

        new aws.lb.Listener(`${this.config.project}-${name}-lst`, {
            loadBalancerArn: nlb.arn,
            port: lstPort,
            protocol: lstProtocol,
            certificateArn: lstProtocol === "TLS" ? lstCertificate.arn : undefined,
            sslPolicy: lstProtocol === "TLS" ? this.config.albSslPolicyDefault : undefined,
            defaultActions: [{
                type: "forward",
                targetGroupArn: targetGroup.arn
            }],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-lst`
            }
        });

        return targetGroup;
    }
}

export {NlbListener}
