/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import {InitConfig} from "../types/module";
import {PhzResult} from "../types";
import {ElastiCacheConfig, ElastiCacheResult} from "../types/elasticache";

class ElastiCache {
    private static __instance: ElastiCache;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): ElastiCache {
        if (this.__instance == null) {
            this.__instance = new ElastiCache();
        }

        return this.__instance;
    }

    async main(
        elastiCacheConfig: ElastiCacheConfig,
        vpc: pulumi.Output<awsx.classic.ec2.Vpc>,
        securityGroupIngress: any [],
        phz: pulumi.Output<PhzResult>,
    ): Promise<ElastiCacheResult> {
        /**
         * KMS
         */
        const kms = new aws.kms.Key(`${this.config.project}-redis-kms`, {
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            description: `${this.config.generalPrefix}-redis-kms`,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-kms`
            }
        });

        new aws.kms.Alias(`${this.config.project}-redis-kms-alias`, {
            name: `alias/${this.config.generalPrefix}-redis-kms`,
            targetKeyId: kms.keyId
        });

        /**
         * SG
         */
        const securityGroup = vpc.apply(x => {
            return new awsx.classic.ec2.SecurityGroup(`${this.config.project}-redis-sg`, {
                description: `${this.config.generalPrefix}-redis-sg`,
                vpc: x,
                ingress: securityGroupIngress,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-redis-sg`,
                },
            });
        });

        /**
         * Database
         */
        const subnetGroup = new aws.elasticache.SubnetGroup(`${this.config.project}-redis-subgrup`, {
            name: `${this.config.generalPrefix}-redis-subgrup`,
            subnetIds: vpc.isolatedSubnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-subgrup`,
            }
        });

        const cluster = new aws.elasticache.ReplicationGroup(`${this.config.project}-redis-cluster`, {
            description: `${this.config.generalPrefix}-redis-cluster`,
            engine: "redis",
            engineVersion: elastiCacheConfig.engineVersion,
            kmsKeyId: kms.arn,
            atRestEncryptionEnabled: true,
            nodeType: elastiCacheConfig.nodeType,
            numNodeGroups: elastiCacheConfig.numNodeGroups,
            replicasPerNodeGroup: elastiCacheConfig.replicasPerNodeGroup,
            snapshotRetentionLimit: elastiCacheConfig.snapshotRetentionLimit,
            subnetGroupName: subnetGroup.name,
            parameterGroupName: elastiCacheConfig.parameterGroupName,
            securityGroupIds: [securityGroup.securityGroup.id],
            port: elastiCacheConfig.port,
            automaticFailoverEnabled: elastiCacheConfig.automaticFailoverEnabled,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-cluster`,
            }
        });

        /**
         * DNS
         */
        new aws.route53.Record(`${this.config.project}-redis-reader-dns`, {
            name: elastiCacheConfig.domainRdsReader,
            type: "CNAME",
            zoneId: phz.zone.zoneId,
            ttl: 300,
            records: [cluster.primaryEndpointAddress],
        });

        new aws.route53.Record(`${this.config.project}-redis-writer-dns`, {
            name: elastiCacheConfig.domainRdsWriter,
            type: "CNAME",
            zoneId: phz.zone.zoneId,
            ttl: 300,
            records: [cluster.readerEndpointAddress],
        });

        return {
            cluster,
            kms,
            securityGroup,
        } as ElastiCacheResult
    }
}

export {ElastiCache}
