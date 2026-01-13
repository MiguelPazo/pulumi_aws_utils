/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {EfsModuleConfig, EfsResult} from "../types";

class Efs {
    private static __instance: Efs;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Efs {
        if (this.__instance == null) {
            this.__instance = new Efs();
        }

        return this.__instance;
    }

    async main(config: EfsModuleConfig): Promise<EfsResult> {
        const {
            efsConfig,
            vpc,
            subnetIds,
            kmsKey,
            tags
        } = config;
        /**
         * KMS
         */
        const kms = kmsKey || new aws.kms.Key(`${this.config.project}-efs-${efsConfig.name}-kms`, {
            description: `${this.config.generalPrefix}-efs-${efsConfig.name}-kms`,
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
                            Sid: "AllowEFSUsage",
                            Effect: "Allow",
                            Principal: {
                                Service: "elasticfilesystem.amazonaws.com",
                            },
                            Action: [
                                "kms:Encrypt",
                                "kms:Decrypt",
                                "kms:List",
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
                Name: `${this.config.generalPrefix}-efs-${efsConfig.name}-kms`
            }
        });

        if (!kmsKey) {
            new aws.kms.Alias(`${this.config.project}-efs-${efsConfig.name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-efs-${efsConfig.name}-kms`,
                targetKeyId: kms.keyId
            });
        }

        /**
         * Security Group
         */
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-efs-${efsConfig.name}-sg`, {
            name: `${this.config.generalPrefix}-efs-${efsConfig.name}-sg`,
            description: `${this.config.generalPrefix}-efs-${efsConfig.name}-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-efs-${efsConfig.name}-sg`,
            },
        });

        new aws.vpc.SecurityGroupEgressRule(`${this.config.project}-efs-${efsConfig.name}-sg-rule-1`, {
            securityGroupId: securityGroup.id,
            description: "Egress to all",
            ipProtocol: aws.ec2.ProtocolType.All,
            fromPort: -1,
            toPort: -1,
            cidrIpv4: "0.0.0.0/0"
        });

        /**
         * EFS File System
         */
        const fileSystem = new aws.efs.FileSystem(`${this.config.project}-efs-${efsConfig.name}`, {
            creationToken: `${this.config.generalPrefix}-efs-${efsConfig.name}`,
            performanceMode: efsConfig.performanceMode || "generalPurpose",
            throughputMode: efsConfig.throughputMode || "provisioned",
            provisionedThroughputInMibps: efsConfig.provisionedThroughputInMibps || 100,
            encrypted: true,
            kmsKeyId: kms.arn,
            lifecyclePolicies: efsConfig.lifecyclePolicy ? [{
                transitionToIa: efsConfig.lifecyclePolicy.transitionToIa || "AFTER_30_DAYS",
                transitionToPrimaryStorageClass: efsConfig.lifecyclePolicy.transitionToPrimaryStorageClass || "AFTER_1_ACCESS"
            }] : undefined,
            tags: {
                ...this.config.generalTags,
                ...tags,
                Name: `${this.config.generalPrefix}-efs-${efsConfig.name}`,
            }
        });

        /**
         * Mount Targets
         */
        const mountTargets = subnetIds.apply(subnets => {
            return subnets.map((subnetId, index) => {
                return new aws.efs.MountTarget(`${this.config.project}-efs-${efsConfig.name}-mt-${index}`, {
                    fileSystemId: fileSystem.id,
                    subnetId: subnetId,
                    securityGroups: [securityGroup.id],
                });
            });
        });

        /**
         * Access Points (optional)
         */
        let accessPoints: pulumi.Output<aws.efs.AccessPoint[]> | undefined;

        if (efsConfig.accessPoints) {
            accessPoints = pulumi.output(efsConfig.accessPoints.map((apConfig, index) => {
                return new aws.efs.AccessPoint(`${this.config.project}-efs-${efsConfig.name}-ap-${index}`, {
                    fileSystemId: fileSystem.id,
                    rootDirectory: {
                        path: apConfig.path,
                        creationInfo: apConfig.creationInfo ? {
                            ownerGid: apConfig.creationInfo.ownerGid,
                            ownerUid: apConfig.creationInfo.ownerUid,
                            permissions: apConfig.creationInfo.permissions,
                        } : undefined,
                    },
                    posixUser: apConfig.posixUser ? {
                        gid: apConfig.posixUser.gid,
                        uid: apConfig.posixUser.uid,
                        secondaryGids: apConfig.posixUser.secondaryGids,
                    } : undefined,
                    tags: {
                        ...this.config.generalTags,
                        Name: `${this.config.generalPrefix}-efs-${efsConfig.name}-ap-${index}`,
                    }
                });
            }));
        }

        return {
            fileSystem,
            kms,
            securityGroup,
            mountTargets,
            accessPoints,
        } as EfsResult;
    }
}

export {Efs}