/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CertificatesResult} from "../types";
import {CertificateKeyAlgorithm} from "./Enums";

class UtilsInfra {
    static createAliasRecord(
        domainCert: CertificatesResult,
        targetDnsName: pulumi.Output<string>,
        targetZoneId: pulumi.Output<string>,
        evaluateTargetHealth?: boolean
    ): void {
        pulumi.all([
            domainCert.domain,
            domainCert.zoneId,
            targetDnsName,
            targetZoneId]).apply(([
                                      domain,
                                      zoneId,
                                      targetDns,
                                      targetZone
                                  ]) => {
            this.createAliasRecordDirect(domain, zoneId, targetDns, targetZone, evaluateTargetHealth);
        });
    }

    static createIpRecord(
        domainCert: CertificatesResult,
        targetIps?: pulumi.Output<string[]>
    ): void {
        pulumi.all([
            domainCert.domain,
            domainCert.zoneId,
            targetIps]).apply(([
                                   domain,
                                   zoneId,
                                   ips
                               ]) => {
            this.createAliasRecordDirect(domain, zoneId, null, null, null, false, ips);
        });
    }

    static createAliasRecordDirect(
        domain: string,
        zoneId: string,
        targetDnsName: string,
        targetZoneId: string,
        evaluateTargetHealth?: boolean,
        isAlias?: boolean,
        targetIps?: string[],
    ): void {
        evaluateTargetHealth = evaluateTargetHealth == undefined ? true : evaluateTargetHealth;
        isAlias = isAlias == undefined ? true : isAlias;

        // TODO: update record name
        new aws.route53.Record(
            `${domain}-alb-record`,
            {
                name: `${domain}.`,
                zoneId: zoneId,
                type: aws.route53.RecordTypes.A,
                aliases: isAlias ? [
                    {
                        name: targetDnsName,
                        zoneId: targetZoneId,
                        evaluateTargetHealth: evaluateTargetHealth
                    },
                ] : undefined,
                records: !isAlias ? targetIps : undefined,
                ttl: !isAlias ? 300 : undefined
            });
    }

    static async createCertificate(
        domain: string,
        zone: aws.route53.Zone,
        generalTags,
        provider?: aws.Provider,
        keyAlgorithm: CertificateKeyAlgorithm = CertificateKeyAlgorithm.RSA_2048
    ): Promise<any> {
        const certOps: any = provider ? {provider: provider, dependsOn: [zone]} : {dependsOn: [zone]};

        const certificate = new aws.acm.Certificate(`${domain}-certificate`, {
            domainName: domain,
            validationMethod: "DNS",
            keyAlgorithm: keyAlgorithm,
            tags: {
                ...generalTags,
                Name: `${domain}-certificate`,
            }
        }, certOps);

        const certificateValidationDomain = new aws.route53.Record(`${domain}-validation`, {
            name: certificate.domainValidationOptions[0].resourceRecordName,
            zoneId: zone.zoneId.apply(x => x),
            type: certificate.domainValidationOptions[0].resourceRecordType,
            records: [certificate.domainValidationOptions[0].resourceRecordValue],
            ttl: 60 * 60
        });

        const certValidation = new aws.acm.CertificateValidation(`${domain}-certificateValidation`, {
            certificateArn: certificate.arn,
            validationRecordFqdns: [certificateValidationDomain.fqdn],
        }, certOps);

        return {certificate, certValidation};
    }

    static getSgByExportedId(sgIds: pulumi.Output<any>, alias: string, project: string): pulumi.Output<aws.ec2.SecurityGroup> {
        return sgIds.apply(id =>
            aws.ec2.SecurityGroup.get(`${project}-${alias.toLowerCase()}-sg`, id[alias])
        );
    }
}

export {UtilsInfra}