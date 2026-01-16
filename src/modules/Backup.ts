/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {BackupConfig, BackupPlan, BackupResult} from "../types";
import {getInit} from "../config";

class Backup {
    private static __instance: Backup;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Backup {
        if (this.__instance == null) {
            this.__instance = new Backup();
        }

        return this.__instance;
    }

    async main(config: BackupConfig): Promise<BackupResult> {
        const {name, kmsKey, copies, plans} = config;

        // Default backup plan if not provided
        const defaultPlans: BackupPlan[] = [
            {
                name: "daily",
                schedule: "cron(0 5 ? * * *)",
                startWindowMinutes: 60,
                completionWindowMinutes: 420,
                deleteAfterDays: 30
            }
        ];

        const backupPlans = plans && plans.length > 0 ? plans : defaultPlans;

        // Create IAM role for AWS Backup
        const backupRole = new aws.iam.Role(`${this.config.project}-${name}-backup-role`, {
            name: `${this.config.generalPrefix}-${name}-backup-role`,
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "backup.amazonaws.com"
                        },
                        Action: "sts:AssumeRole"
                    }
                ]
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-backup-role`
            }
        });

        // Attach AWS managed policies
        new aws.iam.RolePolicyAttachment(`${this.config.project}-${name}-backup-policy-backup`, {
            role: backupRole.name,
            policyArn: "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
        });

        new aws.iam.RolePolicyAttachment(`${this.config.project}-${name}-backup-policy-restores`, {
            role: backupRole.name,
            policyArn: "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
        });

        // Create primary backup vault
        const vault = new aws.backup.Vault(`${this.config.project}-${name}-vault`, {
            name: `${this.config.generalPrefix}-${name}-vault`,
            ...(kmsKey && {kmsKeyArn: kmsKey.arn}),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-vault`
            }
        });

        // Create copy vaults in other regions if copies are provided
        let vaultsCopy: aws.backup.Vault[] | undefined;

        if (copies && copies.length > 0) {
            vaultsCopy = [];

            for (let index = 0; index < copies.length; index++) {
                const copy = copies[index];

                // Get region from provider
                const regionData = await aws.getRegion({}, {provider: copy.provider});
                const region = regionData.region;

                const copyVault = new aws.backup.Vault(`${this.config.project}-${name}-vault-copy-${index}`, {
                    name: `${this.config.generalPrefix}-${name}-vault-copy-${region}`,
                    kmsKeyArn: copy.kmsKey.arn,
                    tags: {
                        ...this.config.generalTags,
                        Name: `${this.config.generalPrefix}-${name}-vault-copy-${region}`
                    }
                }, {provider: copy.provider});

                vaultsCopy.push(copyVault);
            }
        }

        // Generate backup rules from plans
        const backupRules: aws.types.input.backup.PlanRule[] = backupPlans.map(plan => {
            const rule: aws.types.input.backup.PlanRule = {
                ruleName: plan.name,
                targetVaultName: vault.name,
                schedule: plan.schedule,
                scheduleExpressionTimezone: "Etc/UTC",
                startWindow: plan.startWindowMinutes,
                completionWindow: plan.completionWindowMinutes,
                lifecycle: {
                    deleteAfter: plan.deleteAfterDays
                }
            };

            // Add copy actions for each vault copy
            if (vaultsCopy && vaultsCopy.length > 0) {
                rule.copyActions = vaultsCopy.map(copyVault => ({
                    destinationVaultArn: copyVault.arn,
                    lifecycle: {
                        deleteAfter: plan.deleteAfterDays
                    }
                }));
            }

            return rule;
        });

        // Create backup plan for DynamoDB
        const dynamoDbPlan = new aws.backup.Plan(`${this.config.project}-${name}-dynamodb-plan`, {
            name: `${this.config.generalPrefix}-${name}-dynamodb-plan`,
            rules: backupRules,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-dynamodb-plan`
            }
        });

        // Create backup selection for DynamoDB
        const dynamoDbSelection = new aws.backup.Selection(`${this.config.project}-${name}-dynamodb-selection`, {
            name: `${this.config.generalPrefix}-${name}-dynamodb-selection`,
            planId: dynamoDbPlan.id,
            iamRoleArn: backupRole.arn,
            selectionTags: [
                {
                    type: "STRINGEQUALS",
                    key: "backup",
                    value: "dynamodb"
                }
            ]
        });

        // Create backup plan for RDS
        const rdsPlan = new aws.backup.Plan(`${this.config.project}-${name}-rds-plan`, {
            name: `${this.config.generalPrefix}-${name}-rds-plan`,
            rules: backupRules,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-rds-plan`
            }
        });

        // Create backup selection for RDS
        const rdsSelection = new aws.backup.Selection(`${this.config.project}-${name}-rds-selection`, {
            name: `${this.config.generalPrefix}-${name}-rds-selection`,
            planId: rdsPlan.id,
            iamRoleArn: backupRole.arn,
            selectionTags: [
                {
                    type: "STRINGEQUALS",
                    key: "backup",
                    value: "rds"
                }
            ]
        });

        // Create backup plan for EFS
        const efsPlan = new aws.backup.Plan(`${this.config.project}-${name}-efs-plan`, {
            name: `${this.config.generalPrefix}-${name}-efs-plan`,
            rules: backupRules,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-efs-plan`
            }
        });

        // Create backup selection for EFS
        const efsSelection = new aws.backup.Selection(`${this.config.project}-${name}-efs-selection`, {
            name: `${this.config.generalPrefix}-${name}-efs-selection`,
            planId: efsPlan.id,
            iamRoleArn: backupRole.arn,
            selectionTags: [
                {
                    type: "STRINGEQUALS",
                    key: "backup",
                    value: "efs"
                }
            ]
        });

        return {
            role: backupRole,
            vault,
            vaultsCopy,
            planDynamoDb: dynamoDbPlan,
            planRds: rdsPlan,
            planEfs: efsPlan,
            selectionDynamoDb: dynamoDbSelection,
            selectionRds: rdsSelection,
            selectionEfs: efsSelection
        };
    }
}

export {Backup}
