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
        kmsKey?: pulumi.Output<aws.kms.Key>
    ): Promise<ElastiCacheResult> {
        /**
         * KMS
         */
        const kms = kmsKey || new aws.kms.Key(`${this.config.project}-redis-${elastiCacheConfig.name}-kms`, {
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`
            }
        });

        if (!kmsKey) {
            new aws.kms.Alias(`${this.config.project}-redis-${elastiCacheConfig.name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-kms`,
                targetKeyId: kms.keyId
            });
        }

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

        const clusterConfig: any = {
            replicationGroupId: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            description: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            engine: "redis",
            engineVersion: elastiCacheConfig.engineVersion,
            kmsKeyId: kms.arn,
            atRestEncryptionEnabled: true,
            nodeType: elastiCacheConfig.nodeType,
            snapshotRetentionLimit: elastiCacheConfig.snapshotRetentionLimit,
            subnetGroupName: subnetGroup.name,
            parameterGroupName: parameterGroup.name,
            securityGroupIds: [securityGroup.id],
            port: elastiCacheConfig.port,
            automaticFailoverEnabled: elastiCacheConfig.automaticFailoverEnabled,
            applyImmediately: elastiCacheConfig.applyImmediately ?? true,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-redis-${elastiCacheConfig.name}-cluster`,
            }
        };

        if (elastiCacheConfig.authToken) {
            clusterConfig.authToken = elastiCacheConfig.authToken;
            clusterConfig.transitEncryptionEnabled = true;
        }

        if (elastiCacheConfig.clusterMode) {
            clusterConfig.numNodeGroups = elastiCacheConfig.numNodeGroups;
            clusterConfig.replicasPerNodeGroup = elastiCacheConfig.replicasPerNodeGroup;
        } else {
            clusterConfig.numCacheClusters = elastiCacheConfig.numNodeGroups;
        }

        const cluster = new aws.elasticache.ReplicationGroup(`${this.config.project}-redis-${elastiCacheConfig.name}-cluster`, clusterConfig);

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
