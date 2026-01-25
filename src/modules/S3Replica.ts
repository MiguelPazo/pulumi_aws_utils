/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {S3ReplicaConfig, S3ReplicaResult} from "../types";
import {getInit} from "../config";

class S3Replica {
    private static __instance: S3Replica;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): S3Replica {
        if (this.__instance == null) {
            this.__instance = new S3Replica();
        }

        return this.__instance;
    }

    async main(config: S3ReplicaConfig): Promise<S3ReplicaResult> {
        const {
            name,
            sourceKmsArn,
            destKmsArn,
            sourceRegion,
            destRegion,
            s3Source,
            s3Replica,
            createRole,
            replicationRole: existingRole,
            replicationConfigName,
            enableDeleteMarkerReplication = false,
            enableRTC = false
        } = config;

        const roleName = name || 's3-replication';
        const configName = replicationConfigName || roleName;
        let resultRole: aws.iam.Role;
        let replicationRoleArn: pulumi.Input<string>;
        let replicationPolicy: aws.iam.Policy | undefined;
        let replicationConfig: aws.s3.BucketReplicationConfig | undefined;

        /**
         * Create IAM Role and Policy (if createRole is true)
         */
        if (createRole) {
            if (!sourceKmsArn || !destKmsArn || !sourceRegion || !destRegion) {
                throw new Error("sourceKmsArn, destKmsArn, sourceRegion, and destRegion are required when createRole is true");
            }

            /**
             * IAM Policy for S3 Replication
             */
            const policyJson = pulumi.all([
                sourceRegion,
                destRegion,
                sourceKmsArn,
                destKmsArn,
                this.config.accountId
            ]).apply(([
                          srcRegion,
                          dstRegion,
                          srcKms,
                          destKms,
                          accountId
                      ]) => {
                const bucketPrefix = `${this.config.generalPrefix}-${accountId}`;

                const policyStr = fs.readFileSync(__dirname + '/../resources/s3/replication_policy.json', 'utf8')
                    .replace(/rep_bucket_prefix/g, bucketPrefix)
                    .replace(/rep_source_region/g, srcRegion)
                    .replace(/rep_destination_region/g, dstRegion)
                    .replace(/rep_source_kms_arn/g, srcKms)
                    .replace(/rep_destination_kms_arn/g, destKms);

                return JSON.parse(policyStr);
            });

            replicationPolicy = new aws.iam.Policy(`${this.config.project}-${roleName}-policy`, {
                name: `${this.config.generalPrefixShort}-${roleName}-policy`,
                path: "/",
                description: pulumi.interpolate`Policy for S3 replication from ${sourceRegion!} to ${destRegion!}`,
                policy: policyJson,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${roleName}-policy`,
                }
            });

            /**
             * IAM Role for S3 Replication
             */
            const createdRole = new aws.iam.Role(`${this.config.project}-${roleName}-role`, {
                name: `${this.config.generalPrefixShort}-${roleName}-role`,
                assumeRolePolicy: pulumi.output(this.config.accountId).apply(accountId => {
                    return JSON.stringify({
                        Version: "2012-10-17",
                        Statement: [
                            {
                                Effect: "Allow",
                                Principal: {
                                    Service: "s3.amazonaws.com"
                                },
                                Action: "sts:AssumeRole",
                                Condition: {
                                    StringEquals: {
                                        "aws:SourceAccount": accountId
                                    }
                                }
                            }
                        ]
                    });
                }),
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefixShort}-${roleName}-role`,
                }
            });

            /**
             * Attach Policy to Role
             */
            new aws.iam.RolePolicyAttachment(`${this.config.project}-${roleName}-role-attach`, {
                role: createdRole.name,
                policyArn: replicationPolicy.arn,
            });

            resultRole = createdRole;
            replicationRoleArn = createdRole.arn;
        } else {
            /**
             * Use existing role
             */
            if (!existingRole) {
                throw new Error("replicationRole is required when createRole is false");
            }

            // Convert Input to concrete Role using pulumi.output
            resultRole = pulumi.output(existingRole).apply(r => r) as any as aws.iam.Role;
            replicationRoleArn = pulumi.output(existingRole).apply(r => r.arn);
        }

        /**
         * Configure S3 Bucket Replication (only if buckets are provided)
         */
        if (s3Source && s3Replica) {
            if (!destKmsArn) {
                throw new Error("destKmsArn is required when configuring S3 bucket replication");
            }

            /**
             * Configure S3 Bucket Replication with optional RTC
             */
            const replicationOptions: pulumi.CustomResourceOptions = createRole && replicationPolicy
                ? {dependsOn: [replicationPolicy]}
                : {};

            replicationConfig = new aws.s3.BucketReplicationConfig(`${this.config.project}-${configName}-replication`, {
                bucket: pulumi.output(s3Source).apply(b => b.id),
                role: replicationRoleArn,
                rules: [
                    {
                        id: `${this.config.generalPrefix}-replication-rule`,
                        status: "Enabled",
                        priority: 1,
                        deleteMarkerReplication: enableDeleteMarkerReplication ? {
                            status: "Enabled"
                        } : undefined,
                        filter: {},
                        destination: {
                            bucket: pulumi.output(s3Replica).apply(b => b.arn),
                            replicationTime: enableRTC ? {
                                status: "Enabled",
                                time: {
                                    minutes: 15
                                }
                            } : undefined,
                            metrics: enableRTC ? {
                                status: "Enabled",
                                eventThreshold: {
                                    minutes: 15
                                }
                            } : undefined,
                            encryptionConfiguration: {
                                replicaKmsKeyId: destKmsArn
                            },
                            storageClass: "STANDARD"
                        },
                        sourceSelectionCriteria: {
                            sseKmsEncryptedObjects: {
                                status: "Enabled"
                            }
                        }
                    }
                ]
            }, replicationOptions);
        }

        return {
            role: resultRole,
            policy: replicationPolicy,
            replicationConfig: replicationConfig
        } as S3ReplicaResult;
    }
}

export {S3Replica}
