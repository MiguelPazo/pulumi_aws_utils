/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {AlbResult, TgConfig} from "../types/alb";
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
        lstProtocol: string,
        lstPort: number,
        lstCertificate: CertificatesResult,
        tgConfig: TgConfig,
        targetIps?: string[],
        hostHeaderRules?: { host: string; priority: number }[]
    ): Promise<pulumi.Output<aws.lb.TargetGroup>> {
        tgConfig.stickinessEnabled = tgConfig.stickinessEnabled == undefined ? false : tgConfig.stickinessEnabled;

        const targetGroup = alb.vpc.apply(x => {
            return new aws.lb.TargetGroup(`${this.config.project}-${name}-tg`, {
                name: `${this.config.generalPrefixShort}-${name}-tg`,
                vpcId: x.id,
                port: tgConfig.port,
                protocol: tgConfig.protocol.toUpperCase(),
                targetType: tgConfig.targetType,
                deregistrationDelay: 10,
                slowStart: 0,
                proxyProtocolV2: false,
                healthCheck: {
                    enabled: true,
                    path: tgConfig.healthCheck.path,
                    healthyThreshold: tgConfig.healthCheck.healthyThreshold,
                    unhealthyThreshold: tgConfig.healthCheck.unhealthyThreshold,
                    timeout: tgConfig.healthCheck.timeout,
                    interval: tgConfig.healthCheck.interval,
                    matcher: tgConfig.healthCheck.matcher,
                    protocol: tgConfig.healthCheck.protocol ? tgConfig.healthCheck.protocol.toUpperCase() : tgConfig.protocol.toUpperCase(),
                    port: tgConfig.healthCheck.port ? tgConfig.healthCheck.port.toString() : "traffic-port"
                },
                stickiness: tgConfig.stickinessEnabled ? {
                    enabled: tgConfig.stickinessEnabled,
                    cookieDuration: tgConfig.cookieDuration,
                    type: "lb_cookie",
                } : undefined,

                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${name}-tg`,
                }
            });
        });

        lstProtocol = lstProtocol.toUpperCase();
        const isHttps: boolean = lstProtocol === "HTTPS";

        targetGroup.apply(tg => {
            const listener = new aws.lb.Listener(`${this.config.project}-${name}-lst`, {
                loadBalancerArn: alb.alb.loadBalancer.arn,
                port: lstPort,
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
                    targetGroupArn: tg.arn
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
                            targetGroupArn: tg.arn,
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
                        targetGroupArn: tg.arn,
                        targetId: ip,
                        port: tgConfig.port,
                    });
                });
            }
        });

        return targetGroup;
    }
}

export {AlbListener}
