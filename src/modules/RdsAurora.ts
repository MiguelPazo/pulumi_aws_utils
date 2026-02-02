/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {RdsAuroraModuleConfig, RdsAuroraResult} from "../types";

class RdsAurora {
    private static __instance: RdsAurora;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): RdsAurora {
        if (this.__instance == null) {
            this.__instance = new RdsAurora();
        }

        return this.__instance;
    }

    async main(config: RdsAuroraModuleConfig): Promise<RdsAuroraResult> {
        const {
            auroraConfig,
            vpc,
            subnetIds,
            phz,
            kmsKey,
            publicZoneRoodId,
            tags
        } = config;

        /**
         * KMS
         */
        const kms = kmsKey || new aws.kms.Key(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-kms`, {
            description: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-kms`,
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            enableKeyRotation: true,
            policy: pulumi.output(this.config.accountId).apply(x => {
                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Sid: "EnableRootPermissions",
                            Effect: "Allow",
                            Principal: {
                                AWS: `arn:aws:iam::${x}:root`,
                            },
                            Action: "kms:*",
                            Resource: "*",
                        },
                        {
                            Sid: "AllowRDSUsage",
                            Effect: "Allow",
                            Principal: {
                                Service: "rds.amazonaws.com",
                            },
                            Action: [
                                "kms:Encrypt",
                                "kms:Decrypt",
                                "kms:ReEncrypt*",
                                "kms:GenerateDataKey*",
                                "kms:DescribeKey"
                            ],
                            Resource: "*",
                        }
                    ]
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-kms`
            }
        });

        if (!kmsKey) {
            new aws.kms.Alias(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-kms`,
                targetKeyId: kms.keyId
            });
        }

        /**
         * SG
         */
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-sg`, {
            name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-sg`,
            description: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-sg`,
            },
        });

        /**
         * Subnet Group
         */
        const subnetGroup = new aws.rds.SubnetGroup(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-subgrup`, {
            name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-subgrup`,
            subnetIds: subnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-subgrup`,
            }
        });

        /**
         * Cluster Parameter Group
         */
        let clusterParameterGroup: aws.rds.ClusterParameterGroup | undefined;
        if (auroraConfig.clusterParameterGroupValues && auroraConfig.clusterParameterGroupValues.length > 0) {
            clusterParameterGroup = new aws.rds.ClusterParameterGroup(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-cluster-paramgroup`, {
                name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-cluster-paramgroup`,
                description: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-cluster-paramgroup`,
                family: auroraConfig.parameterGroupFamily,
                parameters: auroraConfig.clusterParameterGroupValues,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-cluster-paramgroup`,
                }
            });
        }

        /**
         * DB Parameter Group
         */
        let parameterGroup: aws.rds.ParameterGroup | undefined;
        if (auroraConfig.parameterGroupValues && auroraConfig.parameterGroupValues.length > 0) {
            parameterGroup = new aws.rds.ParameterGroup(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-paramgroup`, {
                name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-paramgroup`,
                description: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-paramgroup`,
                family: auroraConfig.parameterGroupFamily,
                parameters: auroraConfig.parameterGroupValues,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-paramgroup`,
                }
            });
        }

        /**
         * Aurora Cluster
         */
        const clusterConfig: aws.rds.ClusterArgs = {
            clusterIdentifier: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}`,
            engine: auroraConfig.engine,
            engineVersion: auroraConfig.engineVersion,
            dbSubnetGroupName: subnetGroup.name,
            dbClusterParameterGroupName: clusterParameterGroup?.name,
            vpcSecurityGroupIds: [securityGroup.id],
            storageEncrypted: true,
            kmsKeyId: kms.arn,
            backupRetentionPeriod: auroraConfig.backupRetentionPeriod || 7,
            preferredBackupWindow: auroraConfig.preferredBackupWindow || "05:00-06:00",
            preferredMaintenanceWindow: auroraConfig.preferredMaintenanceWindow || "sun:08:00-sun:09:00",
            skipFinalSnapshot: auroraConfig.skipFinalSnapshot,
            enabledCloudwatchLogsExports: auroraConfig.enableCloudwatchLogsExports,
            deletionProtection: this.config.deleteProtection,
            applyImmediately: auroraConfig.applyImmediately ?? false,
            tags: {
                ...this.config.generalTags,
                ...tags,
                Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}`,
            }
        };

        // Configure for Global Database if specified
        if (auroraConfig.globalClusterIdentifier) {
            clusterConfig.globalClusterIdentifier = auroraConfig.globalClusterIdentifier;

            // Secondary clusters don't need these parameters
            if (auroraConfig.isSecondaryCluster) {
                delete clusterConfig.databaseName;
                delete clusterConfig.masterUsername;
                delete clusterConfig.masterPassword;

                // Secondary cluster uses sourceRegion for replication
                if (auroraConfig.sourceRegion) {
                    clusterConfig.sourceRegion = auroraConfig.sourceRegion;
                }
            } else {
                // Primary cluster configuration
                clusterConfig.databaseName = auroraConfig.databaseName;
                clusterConfig.masterUsername = auroraConfig.username;
                clusterConfig.masterPassword = auroraConfig.password;
                clusterConfig.port = auroraConfig.port;
            }
        } else {
            // Standard single-region cluster
            clusterConfig.databaseName = auroraConfig.databaseName;
            clusterConfig.masterUsername = auroraConfig.username;
            clusterConfig.masterPassword = auroraConfig.password;
            clusterConfig.port = auroraConfig.port;
        }

        const cluster = new aws.rds.Cluster(
            `${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}`,
            clusterConfig,
            auroraConfig.isSecondaryCluster ? {
                ignoreChanges: ["globalClusterIdentifier", "replicationSourceIdentifier"]
            } : undefined
        );

        /**
         * Aurora Cluster Instances
         */
        const instances: aws.rds.ClusterInstance[] = [];
        for (let i = 0; i < auroraConfig.instanceCount; i++) {
            const instance = new aws.rds.ClusterInstance(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-instance-${i}`, {
                identifier: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-instance-${i}`,
                clusterIdentifier: cluster.id,
                engine: auroraConfig.engine as aws.rds.EngineType,
                engineVersion: auroraConfig.engineVersion,
                instanceClass: auroraConfig.instanceClass,
                dbParameterGroupName: parameterGroup?.name,
                performanceInsightsEnabled: auroraConfig.enablePerformanceInsights || false,
                publiclyAccessible: auroraConfig.publiclyAccessible,
                applyImmediately: auroraConfig.applyImmediately ?? false,
                tags: {
                    ...this.config.generalTags,
                    ...tags,
                    Name: `${this.config.generalPrefix}-${auroraConfig.engine}-${auroraConfig.name}-instance-${i}`,
                }
            });
            instances.push(instance);
        }

        /**
         * PHZ Records
         */
        cluster.readerEndpoint.apply(readerEndpoint => {
            new aws.route53.Record(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-reader-dns-private`, {
                name: auroraConfig.domainRdsReader!,
                type: "CNAME",
                zoneId: phz.zone.zoneId,
                ttl: 300,
                records: [readerEndpoint],
            });
        });

        cluster.endpoint.apply(writerEndpoint => {
            new aws.route53.Record(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-writer-dns-private`, {
                name: auroraConfig.domainRdsWriter!,
                type: "CNAME",
                zoneId: phz.zone.zoneId,
                ttl: 300,
                records: [writerEndpoint],
            });
        });

        /**
         * Public DNS Records
         */
        if (publicZoneRoodId && auroraConfig.domainPublicRdsWriter && auroraConfig.domainPublicRdsReader) {
            cluster.readerEndpoint.apply(readerEndpoint => {
                new aws.route53.Record(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-reader-dns-public`, {
                    name: auroraConfig.domainPublicRdsReader!,
                    type: "CNAME",
                    zoneId: publicZoneRoodId,
                    ttl: 300,
                    records: [readerEndpoint],
                });
            });

            cluster.endpoint.apply(writerEndpoint => {
                new aws.route53.Record(`${this.config.project}-${auroraConfig.engine}-${auroraConfig.name}-writer-dns-public`, {
                    name: auroraConfig.domainPublicRdsWriter!,
                    type: "CNAME",
                    zoneId: publicZoneRoodId,
                    ttl: 300,
                    records: [writerEndpoint],
                });
            });
        }

        return {
            cluster,
            instances,
            kms,
            securityGroup,
            clusterParameterGroup,
            parameterGroup,
        } as RdsAuroraResult
    }
}

export {RdsAurora}