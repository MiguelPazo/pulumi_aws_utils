/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {CertificatesResult, LBConfig, VpcImportResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

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
        vpc: pulumi.Output<VpcImportResult>,
        lstCertificate: CertificatesResult,
        lbConfig: LBConfig
    ): Promise<aws.lb.TargetGroup> {
        const targetGroup = new aws.lb.TargetGroup(`${this.config.project}-${name}-tg`, {
            name: `${this.config.generalPrefixShort}-${name}-tg`,
            vpcId: vpc.id,
            port: lbConfig.tgPort,
            protocol: lbConfig.tgProtocol.toUpperCase(),
            targetType: lbConfig.tgTargetType,
            deregistrationDelay: 10,
            slowStart: 0,
            proxyProtocolV2: false,
            healthCheck: {
                enabled: true,
                healthyThreshold: lbConfig.tgHealthCheck.healthyThreshold,
                unhealthyThreshold: lbConfig.tgHealthCheck.unhealthyThreshold,
                timeout: lbConfig.tgHealthCheck.timeout,
                interval: lbConfig.tgHealthCheck.interval,
                protocol: lbConfig.tgHealthCheck.protocol,
                port: lbConfig.tgHealthCheck.port.toString(),
                matcher: lbConfig.tgHealthCheck.protocol === "TCP" ? undefined : lbConfig.tgHealthCheck.matcher,
                path: lbConfig.tgHealthCheck.protocol === "TCP" ? undefined : lbConfig.tgHealthCheck.path,
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${name}-tg`,
            }
        }, {
            dependsOn: [
                nlb
            ]
        });

        const lstProtocol = lbConfig.lstProtocol.toUpperCase();

        new aws.lb.Listener(`${this.config.project}-${name}-lst`, {
            loadBalancerArn: nlb.arn,
            port: lbConfig.lstPort,
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
