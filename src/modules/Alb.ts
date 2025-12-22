/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import {UtilsInfra} from "../common/UtilsInfra";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {AlbResult, CertificatesResult, PhzResult, VpcImportResult} from "../types";
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
        vpc: pulumi.Output<VpcImportResult>,
        s3Logs?: pulumi.Output<aws.s3.BucketV2>,
        internal?: boolean,
        certificate?: CertificatesResult,
        domain?: string,
        createRoute53Record?: boolean,
        phz?: pulumi.Output<PhzResult>,
        createDefaultListener?: boolean,
    ): Promise<AlbResult> {
        createDefaultListener = createDefaultListener == undefined ? false : createDefaultListener;
        internal = internal == undefined ? true : internal;
        createRoute53Record = createRoute53Record == undefined ? true : createRoute53Record;

        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-${name}-alb-sg`, {
            name: `${this.config.generalPrefixShort}-${name}-alb-sg`,
            description: `${this.config.generalPrefixShort}-${name}-alb-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${name}-alb-sg`,
            },
        });

        new aws.vpc.SecurityGroupEgressRule(`${this.config.project}-${name}-alb-sg-rule-1`, {
            securityGroupId: securityGroup.id,
            description: "Egress to all",
            ipProtocol: aws.ec2.ProtocolType.All,
            fromPort: -1,
            toPort: -1,
            cidrIpv4: "0.0.0.0/0"
        });

        let albName = `${this.config.generalPrefixShort}-${name}-alb`;
        albName = albName.length > 32 ? `${this.config.generalPrefixShort2}-${name}-alb` : albName;

        const alb = new aws.lb.LoadBalancer(`${this.config.project}-${name}-alb`, {
            name: albName,
            enableDeletionProtection: this.config.deleteProtection,
            internal: internal,
            loadBalancerType: aws.alb.LoadBalancerType.Application,
            enableCrossZoneLoadBalancing: true,
            subnets: internal ? vpc.privateSubnetIds : vpc.publicSubnetIds,
            securityGroups: [securityGroup.id],
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

        /**
         * Default Listener
         */
        if (createDefaultListener) {
            new aws.lb.Listener(`${this.config.project}-${name}-alb-default-http`, {
                loadBalancerArn: alb.arn,
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

            if (internal || certificate) {
                new aws.lb.Listener(`${this.config.project}-${name}-alb-default-https`, {
                    loadBalancerArn: alb.arn,
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
                    loadBalancerArn: alb.arn,
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
        if (createRoute53Record) {
            if (certificate) {
                UtilsInfra.createAliasRecord(certificate, alb.dnsName, alb.zoneId, true);
            } else if (phz) {
                pulumi.all([phz.zone.zoneId, alb.dnsName, alb.zoneId]).apply(([zoneID, dnsName, zoneId]) => {
                    UtilsInfra.createAliasRecordDirect(domain, zoneID, dnsName, zoneId, true);
                });
            }
        }

        return {
            alb,
            securityGroup,
            vpc
        } as AlbResult
    }
}

export {Alb}
