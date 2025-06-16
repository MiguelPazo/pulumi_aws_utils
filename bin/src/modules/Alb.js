"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Alb = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const awsx = require("@pulumi/awsx");
const UtilsInfra_1 = require("../common/UtilsInfra");
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config_1 = require("../config");
class Alb {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new Alb();
        }
        return this.__instance;
    }
    async main(name, vpc, domain, phz, s3Logs, enableDeletionProtection, createDefaultListener, external, certificate) {
        createDefaultListener = createDefaultListener == undefined ? false : createDefaultListener;
        external = external == undefined ? false : external;
        enableDeletionProtection = enableDeletionProtection == undefined ? true : enableDeletionProtection;
        const securityGroup = vpc.apply(x => {
            return new awsx.classic.ec2.SecurityGroup(`${this.config.project}-${name}-alb-sg`, {
                description: `${this.config.generalPrefixShort}-${name}-alb-sg`,
                vpc: x,
                egress: [{
                        protocol: "-1",
                        fromPort: 0,
                        toPort: 0,
                        cidrBlocks: ["0.0.0.0/0"],
                        description: "Egress to all"
                    }],
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${name}-alb-sg`,
                },
            });
        });
        const alb = vpc.apply(x => {
            return new awsx.classic.lb.ApplicationLoadBalancer(`${this.config.project}-${name}-alb`, {
                name: `${this.config.generalPrefixShort}-${name}-alb`,
                enableDeletionProtection: enableDeletionProtection,
                vpc: x,
                external: external,
                securityGroups: [securityGroup.securityGroup.id],
                accessLogs: s3Logs ? {
                    enabled: true,
                    bucket: s3Logs.bucket,
                    prefix: `${this.config.generalPrefixShort}-${name}-alb`
                } : undefined,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${name}-alb`
                }
            });
        });
        /**
         * Default Listener
         */
        if (createDefaultListener) {
            new aws.lb.Listener(`${this.config.project}-${name}-alb-default-http`, {
                loadBalancerArn: alb.loadBalancer.arn,
                port: 80,
                protocol: "HTTP",
                defaultActions: [{
                        type: "fixed-response",
                        fixedResponse: {
                            contentType: "text/plain",
                            messageBody: "Not Found",
                            statusCode: "404"
                        }
                    }],
            });
            if (external) {
                new aws.lb.Listener(`${this.config.project}-${name}-alb-default-https`, {
                    loadBalancerArn: alb.loadBalancer.arn,
                    port: 443,
                    protocol: "HTTPS",
                    sslPolicy: this.config.albSslPolicyDefault,
                    certificateArn: certificate.arn,
                    defaultActions: [{
                            type: "fixed-response",
                            fixedResponse: {
                                contentType: "text/plain",
                                messageBody: "Not Found",
                                statusCode: "404"
                            }
                        }],
                });
            }
            else {
                new aws.lb.Listener(`${this.config.project}-${name}-alb-default-https`, {
                    loadBalancerArn: alb.loadBalancer.arn,
                    port: 443,
                    protocol: "HTTPS",
                    sslPolicy: this.config.albSslPolicyDefault,
                    certificateArn: phz.cert.arn,
                    defaultActions: [{
                            type: "fixed-response",
                            fixedResponse: {
                                contentType: "text/plain",
                                messageBody: "Not Found",
                                statusCode: "404"
                            }
                        }],
                });
            }
        }
        /**
         * Route53
         */
        if (external) {
            pulumi.output(alb.loadBalancer).apply(x => {
                UtilsInfra_1.UtilsInfra.createAliasRecord(certificate, x.dnsName, x.zoneId, true);
            });
        }
        else {
            pulumi.all([phz.zone.zoneId, alb.loadBalancer]).apply(([zoneID, loadBalancer]) => {
                pulumi.all([loadBalancer.dnsName, loadBalancer.zoneId]).apply(x => {
                    UtilsInfra_1.UtilsInfra.createAliasRecordDirect(domain, zoneID, x[0], x[1], true);
                });
            });
        }
        return {
            alb,
            securityGroup,
            vpc
        };
    }
}
exports.Alb = Alb;
//# sourceMappingURL=Alb.js.map