/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmsGuardDutyConfig, AlarmsGuardDutyResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class AlarmsGuardDuty {
    private static __instance: AlarmsGuardDuty;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlarmsGuardDuty {
        if (this.__instance == null) {
            this.__instance = new AlarmsGuardDuty();
        }

        return this.__instance;
    }

    async main(gdConfig: AlarmsGuardDutyConfig): Promise<AlarmsGuardDutyResult> {
        const metricFilters: aws.cloudwatch.LogMetricFilter[] = [];
        const alarms: aws.cloudwatch.MetricAlarm[] = [];
        const namespace = `${this.config.generalPrefix}/guardduty`;

        // Prioritize lambdaAlarmsArn over snsTopicArn
        const actionArn = gdConfig.lambdaAlarmsArn || gdConfig.snsTopicArn;

        if (!actionArn) {
            throw new Error("Either lambdaAlarmsArn or snsTopicArn must be provided");
        }

        const metrics: { enabled: boolean; shortName: string; metricName: string; pattern: string; description: string }[] = [
            {
                enabled: gdConfig.monitorCredentialExfiltrationOutsideAws !== false,
                shortName: "cred-exfil-outside",
                metricName: "CredentialExfiltrationOutsideAWS",
                pattern: '{ $.detail.type = "UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS" }',
                description: "GuardDuty: Credential Exfiltration Outside AWS"
            },
            {
                enabled: gdConfig.monitorCredentialExfiltrationInsideAws !== false,
                shortName: "cred-exfil-inside",
                metricName: "CredentialExfiltrationInsideAWS",
                pattern: '{ $.detail.type = "UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.InsideAWS" }',
                description: "GuardDuty: Credential Exfiltration Inside AWS"
            },
            {
                enabled: gdConfig.monitorConsoleLoginUnusualIp !== false,
                shortName: "console-login-unusual",
                metricName: "ConsoleLoginUnusualIP",
                pattern: '{ $.detail.type = "UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B" }',
                description: "GuardDuty: Console Login from Unusual IP"
            },
            {
                enabled: gdConfig.monitorAnomalousCredentialAccess !== false,
                shortName: "anomalous-cred-access",
                metricName: "AnomalousCredentialAccess",
                pattern: '{ $.detail.type = "CredentialAccess:IAMUser/AnomalousBehavior" }',
                description: "GuardDuty: Anomalous Credential Access"
            },
            {
                enabled: gdConfig.monitorMaliciousIpCaller !== false,
                shortName: "malicious-ip-caller",
                metricName: "MaliciousIPCaller",
                pattern: '{ $.detail.type = "UnauthorizedAccess:IAMUser/MaliciousIPCaller.Custom" }',
                description: "GuardDuty: API Call from Malicious IP"
            },
            {
                enabled: gdConfig.monitorEcsReverseShell !== false,
                shortName: "ecs-reverse-shell",
                metricName: "EcsReverseShell",
                pattern: '{ $.detail.type = "Execution:Runtime/ReverseShell" }',
                description: "GuardDuty: ECS Reverse Shell Detected"
            },
            {
                enabled: gdConfig.monitorEcsSuspiciousTool !== false,
                shortName: "ecs-suspicious-tool",
                metricName: "EcsSuspiciousTool",
                pattern: '{ $.detail.type = "Execution:Runtime/SuspiciousTool" }',
                description: "GuardDuty: ECS Suspicious Tool Executed"
            },
            {
                enabled: gdConfig.monitorEcsNewBinaryExecuted !== false,
                shortName: "ecs-new-binary",
                metricName: "EcsNewBinaryExecuted",
                pattern: '{ $.detail.type = "Execution:Runtime/NewBinaryExecuted" }',
                description: "GuardDuty: ECS New Binary Executed"
            },
            {
                enabled: gdConfig.monitorEcsProcessDiscovered !== false,
                shortName: "ecs-process-discovered",
                metricName: "EcsProcessDiscovered",
                pattern: '{ $.detail.type = "Discovery:Runtime/ProcessDiscovered" }',
                description: "GuardDuty: ECS Process Discovery Detected"
            },
            {
                enabled: gdConfig.monitorEcsProcessInjected !== false,
                shortName: "ecs-process-injected",
                metricName: "EcsProcessInjected",
                pattern: '{ $.detail.type = "DefenseEvasion:Runtime/ProcessInjected" }',
                description: "GuardDuty: ECS Process Injection Detected"
            },
            {
                enabled: gdConfig.monitorEcsCGroupsReleaseAgent !== false,
                shortName: "ecs-cgroups-escape",
                metricName: "EcsCGroupsReleaseAgent",
                pattern: '{ $.detail.type = "PrivilegeEscalation:Runtime/CGroupsReleaseAgentModified" }',
                description: "GuardDuty: ECS CGroups Release Agent Modified"
            },
            {
                enabled: gdConfig.monitorEc2MetadataServiceAccess !== false,
                shortName: "ec2-imds-access",
                metricName: "Ec2MetadataServiceAccess",
                pattern: '{ $.detail.type = "CredentialAccess:Kubernetes/MaliciousIPCaller.Custom" || $.detail.type = "CredentialAccess:Kubernetes/MaliciousIPCaller" || $.detail.type = "CredentialAccess:Kubernetes/TorIPCaller" }',
                description: "GuardDuty: Credential Access via metadata service (Kubernetes)"
            },
            {
                enabled: gdConfig.monitorEcsMetadataServiceAccess !== false,
                shortName: "ecs-imds-access",
                metricName: "EcsMetadataServiceAccess",
                pattern: '{ $.detail.type = "CredentialAccess:Runtime/ECSMetadataAccess" }',
                description: "GuardDuty: ECS task credential access via metadata service"
            }
        ];

        for (const metric of metrics) {
            if (metric.enabled) {
                const {metricFilter, alarm} = this.createMetric(
                    gdConfig.logGroupName,
                    actionArn,
                    namespace,
                    metric.shortName,
                    metric.metricName,
                    metric.pattern,
                    metric.description
                );
                metricFilters.push(metricFilter);
                alarms.push(alarm);
            }
        }

        return {
            metricFilters,
            alarms
        };
    }

    /**
     * Create a metric filter and alarm for a specific GuardDuty finding type
     */
    private createMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string,
        shortName: string,
        metricName: string,
        pattern: string,
        description: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-gd-${shortName}-filter`,
            {
                name: `${this.config.generalPrefix}-gd-${shortName}`,
                logGroupName: logGroupName,
                pattern: pattern,
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-gd-${shortName}-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/gd-${shortName}`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: description,
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/gd-${shortName}`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }
}

export {AlarmsGuardDuty}
