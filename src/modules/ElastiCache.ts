/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {ElastiCacheConfig, ElastiCacheResult, PhzResult, VpcImportResult} from "../types";

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
        vpc: pulumi.Output<VpcImportResult>,
        subnetIds: pulumi.Output<string[]>,
        phz: pulumi.Output<PhzResult>,
    ): Promise<ElastiCacheResult> {
        /**
         * KMS
         */
        const kms = new aws.kms.Key(`${this.config.project}-redis-${elastiCacheConfig.name}-kms`, {
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`
            }
        });

        new aws.kms.Alias(`${this.config.project}-redis-${elastiCacheConfig.name}-kms-alias`, {
            name: `alias/${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`,
            targetKeyId: kms.keyId
        });

        /**
         * SG
         */
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-redis-${elastiCacheConfig.name}-sg`, {
            name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-sg`,
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-sg`,
            },
        });

        /**
         * Database
         */
        const subnetGroup = new aws.elasticache.SubnetGroup(`${this.config.project}-redis-${elastiCacheConfig.name}-subgrup`, {
            name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-subgrup`,
            subnetIds: subnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-subgrup`,
            }
        });

        const parameterGroup = new aws.elasticache.ParameterGroup(`${this.config.project}-redis-${elastiCacheConfig.name}-paramgroup`, {
            name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-paramgroup`,
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-paramgroup`,
            family: elastiCacheConfig.parameterGroupFamily,
            parameters: elastiCacheConfig.parameterGroupValues,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-paramgroup`,
            }
        });

        const cluster = new aws.elasticache.ReplicationGroup(`${this.config.project}-redis-${elastiCacheConfig.name}-cluster`, {
            replicationGroupId: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            engine: "redis",
            engineVersion: elastiCacheConfig.engineVersion,
            kmsKeyId: kms.arn,
            atRestEncryptionEnabled: true,
            nodeType: elastiCacheConfig.nodeType,
            numNodeGroups: elastiCacheConfig.numNodeGroups,
            replicasPerNodeGroup: elastiCacheConfig.replicasPerNodeGroup,
            snapshotRetentionLimit: elastiCacheConfig.snapshotRetentionLimit,
            subnetGroupName: subnetGroup.name,
            parameterGroupName: parameterGroup.name,
            securityGroupIds: [securityGroup.id],
            port: elastiCacheConfig.port,
            automaticFailoverEnabled: elastiCacheConfig.automaticFailoverEnabled,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            }
        });

        /**
         * DNS
         */
        new aws.route53.Record(`${this.config.project}-redis-${elastiCacheConfig.name}-reader-dns`, {
            name: elastiCacheConfig.domainRdsReader,
            type: "CNAME",
            zoneId: phz.zone.zoneId,
            ttl: 300,
            records: [cluster.readerEndpointAddress],
        });

        new aws.route53.Record(`${this.config.project}-redis-${elastiCacheConfig.name}-writer-dns`, {
            name: elastiCacheConfig.domainRdsWriter,
            type: "CNAME",
            zoneId: phz.zone.zoneId,
            ttl: 300,
            records: [cluster.primaryEndpointAddress],
        });

        return {
            cluster,
            kms,
            securityGroup,
        } as ElastiCacheResult
    }
}

export {ElastiCache}
