"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlbListener = void 0;
const aws = require("@pulumi/aws");
const config_1 = require("../config");
class AlbListener {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new AlbListener();
        }
        return this.__instance;
    }
    async main(name, alb, lstProtocol, lstPort, lstCertificate, tgConfig) {
        tgConfig.stickinessEnabled = tgConfig.stickinessEnabled == undefined ? false : tgConfig.stickinessEnabled;
        const targetGroup = alb.vpc.apply(x => {
            return new aws.lb.TargetGroup(`${this.config.project}-${name}-tg`, {
                name: `${this.config.generalPrefixShort}-${name}-tg`,
                vpcId: x.id,
                port: tgConfig.port,
                protocol: tgConfig.protocol.toUpperCase(),
                targetType: tgConfig.targetType,
                deregistrationDelay: 300,
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
                    protocol: tgConfig.healthCheck.protocol,
                    port: tgConfig.healthCheck.port.toString()
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
        const isHttps = lstProtocol === "HTTPS";
        targetGroup.apply(x => {
            new aws.lb.Listener(`${this.config.project}-${name}-lst`, {
                loadBalancerArn: alb.alb.loadBalancer.arn,
                port: lstPort,
                protocol: lstProtocol,
                certificateArn: isHttps ? lstCertificate.arn : undefined,
                sslPolicy: isHttps ? this.config.albSslPolicyDefault : undefined,
                defaultActions: [{
                        type: "forward",
                        targetGroupArn: x.arn
                    }],
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${name}-lst`
                }
            });
        });
        return targetGroup;
    }
}
exports.AlbListener = AlbListener;
//# sourceMappingURL=AlbListener.js.map