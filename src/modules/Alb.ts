/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as awsx from "@pulumi/awsx";
import {UtilsInfra} from "../common/UtilsInfra";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {CertificatesResult, PhzResult} from "../types/base";
import {AlbResult} from "../types/alb";
import {getInit} from "../config";
import {InitConfig} from "../types/module";

class Alb {
    private static __instance: Alb;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Alb {
        if (this.__instance == null) {
            this.__instance = new Alb();
        }

        return this.__instance;
    }

    async main(
        name: string,
        vpc: pulumi.Output<awsx.classic.ec2.Vpc>,
        domain?: string,
        phz?: pulumi.Output<PhzResult>,
        s3Logs?: pulumi.Output<aws.s3.Bucket>,
        enableDeletionProtection?: boolean,
        createDefaultListener?: boolean,
        external?: boolean,
        certificate?: CertificatesResult,
    ): Promise<AlbResult> {
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
        })

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
        })

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
            } else {
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
                UtilsInfra.createAliasRecord(certificate, x.dnsName, x.zoneId, true);
            })
        } else {
            pulumi.all([phz.zone.zoneId, alb.loadBalancer]).apply(([zoneID, loadBalancer]) => {
                pulumi.all([loadBalancer.dnsName, loadBalancer.zoneId]).apply(x => {
                    UtilsInfra.createAliasRecordDirect(domain, zoneID, x[0], x[1], true);
                })
            });
        }

        return {
            alb,
            securityGroup,
            vpc
        } as AlbResult
    }
}

export {Alb}
