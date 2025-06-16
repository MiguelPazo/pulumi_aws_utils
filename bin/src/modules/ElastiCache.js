"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElastiCache = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const config_1 = require("../config");
const awsx = require("@pulumi/awsx");
class ElastiCache {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new ElastiCache();
        }
        return this.__instance;
    }
    async main(elastiCacheConfig, vpc, securityGroupIngress, phz) {
        /**
         * KMS
         */
        const kmsRedis = new aws.kms.Key(`${this.config.project}-redis-kms`, {
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
            targetKeyId: kmsRedis.keyId
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
        const redisCluster = new aws.elasticache.ReplicationGroup(`${this.config.project}-redis-cluster`, {
            description: `${this.config.generalPrefix}-redis-cluster`,
            engine: "redis",
            engineVersion: elastiCacheConfig.engineVersion,
            kmsKeyId: kmsRedis.arn,
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
            records: [redisCluster.primaryEndpointAddress],
        });
        new aws.route53.Record(`${this.config.project}-redis-writer-dns`, {
            name: elastiCacheConfig.domainRdsWriter,
            type: "CNAME",
            zoneId: phz.zone.zoneId,
            ttl: 300,
            records: [redisCluster.readerEndpointAddress],
        });
    }
}
exports.ElastiCache = ElastiCache;
//# sourceMappingURL=ElastiCache.js.map