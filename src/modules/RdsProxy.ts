/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {RdsProxyModuleConfig, RdsProxyResult} from "../types";

class RdsProxy {
    private static __instance: RdsProxy;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): RdsProxy {
        if (this.__instance == null) {
            this.__instance = new RdsProxy();
        }

        return this.__instance;
    }

    async main(config: RdsProxyModuleConfig): Promise<RdsProxyResult> {
        const {
            proxyConfig,
            vpc,
            subnetIds,
            targetClusterIdentifier,
            iamRole,
            phz,
            publicZoneRootId
        } = config;

        /**
         * Security Group
         */
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-rdsproxy-${proxyConfig.name}-sg`, {
            name: `${this.config.generalPrefix}-rdsproxy-${proxyConfig.name}-sg`,
            description: `${this.config.generalPrefix}-rdsproxy-${proxyConfig.name}-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rdsproxy-${proxyConfig.name}-sg`,
            },
        });

        /**
         * RDS Proxy
         */
        const proxy = new aws.rds.Proxy(`${this.config.project}-rdsproxy-${proxyConfig.name}`, {
            name: `${this.config.generalPrefix}-rdsproxy-${proxyConfig.name}`,
            engineFamily: proxyConfig.engineFamily,
            roleArn: iamRole.arn,
            vpcSubnetIds: subnetIds,
            vpcSecurityGroupIds: [securityGroup.id],
            auths: proxyConfig.auths.map(auth => ({
                authScheme: auth.authScheme || "SECRETS",
                iamAuth: auth.iamAuth || "DISABLED",
                secretArn: auth.secretArn,
                clientPasswordAuthType: auth.clientPasswordAuthType,
            })),
            requireTls: proxyConfig.requireTls !== undefined ? proxyConfig.requireTls : true,
            debugLogging: proxyConfig.debugLogging !== undefined ? proxyConfig.debugLogging : false,
            idleClientTimeout: proxyConfig.idleClientTimeout || 1800,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rdsproxy-${proxyConfig.name}`,
            }
        });

        /**
         * Default Target Group
         */
        const defaultTargetGroup = new aws.rds.ProxyDefaultTargetGroup(`${this.config.project}-rdsproxy-${proxyConfig.name}-tg`, {
            dbProxyName: proxy.name,
            connectionPoolConfig: {
                connectionBorrowTimeout: proxyConfig.maxConnectionsPercent || 120,
                maxConnectionsPercent: proxyConfig.maxConnectionsPercent || 100,
                maxIdleConnectionsPercent: proxyConfig.maxIdleConnectionsPercent || 50,
            },
        });

        /**
         * Proxy Target
         */
        const target = new aws.rds.ProxyTarget(`${this.config.project}-rdsproxy-${proxyConfig.name}-target`, {
            dbProxyName: proxy.name,
            targetGroupName: defaultTargetGroup.name,
            dbClusterIdentifier: targetClusterIdentifier
        });

        /**
         * DNS Record
         */
        if (proxyConfig.domainRdsProxy && phz) {
            proxy.endpoint.apply(endpoint => {
                new aws.route53.Record(`${this.config.project}-rdsproxy-${proxyConfig.name}-dns-private`, {
                    name: proxyConfig.domainRdsProxy!,
                    type: "CNAME",
                    zoneId: phz.zone.zoneId,
                    ttl: 300,
                    records: [endpoint],
                });
            });
        }

        if (proxyConfig.domainPublicRdsProxy && publicZoneRootId) {
            proxy.endpoint.apply(endpoint => {
                new aws.route53.Record(`${this.config.project}-rdsproxy-${proxyConfig.name}-dns-public`, {
                    name: proxyConfig.domainPublicRdsProxy!,
                    type: "CNAME",
                    zoneId: publicZoneRootId,
                    ttl: 300,
                    records: [endpoint],
                });
            });
        }

        return {
            proxy,
            defaultTargetGroup,
            target,
            securityGroup,
        } as RdsProxyResult;
    }
}

export {RdsProxy}
