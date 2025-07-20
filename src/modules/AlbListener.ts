/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {AlbResult, LBConfig} from "../types/alb";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {CertificatesResult} from "../types";

class AlbListener {
    private static __instance: AlbListener;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlbListener {
        if (this.__instance == null) {
            this.__instance = new AlbListener();
        }

        return this.__instance;
    }

    async main(
        name: string,
        alb: AlbResult,
        lstCertificate: CertificatesResult,
        lbConfig: LBConfig,
        targetIps?: string[],
        hostHeaderRules?: { host: string; priority: number }[]
    ): Promise<aws.lb.TargetGroup> {
        lbConfig.tgStickinessEnabled = lbConfig.tgStickinessEnabled == undefined ? false : lbConfig.tgStickinessEnabled;

        const targetGroup = new aws.lb.TargetGroup(`${this.config.project}-${name}-tg`, {
            name: `${this.config.generalPrefixShort}-${name}-tg`,
            vpcId: alb.vpc.vpc.id,
            port: lbConfig.tgPort,
            protocol: lbConfig.tgProtocol.toUpperCase(),
            targetType: lbConfig.tgTargetType,
            deregistrationDelay: 10,
            slowStart: 0,
            proxyProtocolV2: false,
            healthCheck: {
                enabled: true,
                path: lbConfig.tgHealthCheck.path,
                healthyThreshold: lbConfig.tgHealthCheck.healthyThreshold,
                unhealthyThreshold: lbConfig.tgHealthCheck.unhealthyThreshold,
                timeout: lbConfig.tgHealthCheck.timeout,
                interval: lbConfig.tgHealthCheck.interval,
                matcher: lbConfig.tgHealthCheck.matcher,
                protocol: lbConfig.tgHealthCheck.protocol ? lbConfig.tgHealthCheck.protocol.toUpperCase() : lbConfig.tgProtocol.toUpperCase(),
                port: lbConfig.tgHealthCheck.port ? lbConfig.tgHealthCheck.port.toString() : "traffic-port"
            },
            stickiness: lbConfig.tgStickinessEnabled ? {
                enabled: lbConfig.tgStickinessEnabled,
                cookieDuration: lbConfig.tgCookieDuration,
                type: "lb_cookie",
            } : undefined,

            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${name}-tg`,
            }
        });

        const lstProtocol = lbConfig.lstProtocol.toUpperCase();
        const isHttps: boolean = lstProtocol === "HTTPS";

        const listener = new aws.lb.Listener(`${this.config.project}-${name}-lst`, {
            loadBalancerArn: alb.alb.arn,
            port: lbConfig.lstPort,
            protocol: lstProtocol,
            certificateArn: isHttps ? lstCertificate.arn : undefined,
            sslPolicy: isHttps ? this.config.albSslPolicyDefault : undefined,
            defaultActions: hostHeaderRules && hostHeaderRules.length > 0 ? [{
                type: "fixed-response",
                fixedResponse: {
                    contentType: "text/plain",
                    messageBody: "Unathorized Access",
                    statusCode: "403"
                }
            }] : [{
                type: "forward",
                targetGroupArn: targetGroup.arn
            }],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-lst`
            }
        });

        if (hostHeaderRules && hostHeaderRules.length > 0) {
            for (const rule of hostHeaderRules) {
                new aws.lb.ListenerRule(`${this.config.project}-${name}-hostrule-${rule.priority}`, {
                    listenerArn: listener.arn,
                    priority: rule.priority,
                    actions: [{
                        type: "forward",
                        targetGroupArn: targetGroup.arn,
                    }],
                    conditions: [{
                        hostHeader: {
                            values: [rule.host],
                        },
                    }],
                    tags: {
                        ...this.config.generalTags,
                        Name: `${this.config.generalPrefix}-${name}-hostrule-${rule.priority}`
                    }
                });
            }
        }

        if (targetIps && targetIps.length > 0) {
            targetIps.forEach((ip, index) => {
                new aws.lb.TargetGroupAttachment(`${this.config.project}-${name}-tgattach-${index + 1}`, {
                    targetGroupArn: targetGroup.arn,
                    targetId: ip,
                    port: lbConfig.tgPort,
                });
            });
        }

        return targetGroup;
    }
}

export {AlbListener}
