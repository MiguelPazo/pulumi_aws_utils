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

    static createAliasRecordWithCustomDomain(
        customDomain: string,
        domainCert: CertificatesResult,
        targetDnsName: pulumi.Output<string>,
        targetZoneId: pulumi.Output<string>,
        evaluateTargetHealth?: boolean
    ): void {
        pulumi.all([
            domainCert.zoneId,
            targetDnsName,
            targetZoneId]).apply(([
                                      zoneId,
                                      targetDns,
                                      targetZone
                                  ]) => {
            this.createAliasRecordDirect(customDomain, zoneId, targetDns, targetZone, evaluateTargetHealth);
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

        new aws.route53.Record(
            `${domain}-record`,
            {
                name: `${domain}.`,
                zoneId: zoneId,
                type: aws.route53.RecordType.A,
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
        keyAlgorithm: CertificateKeyAlgorithm = CertificateKeyAlgorithm.RSA_2048,
        domainsAlt: string[] = []
    ): Promise<any> {
        const certOps: any = provider ? {provider: provider, dependsOn: [zone]} : {dependsOn: [zone]};

        const certificate = new aws.acm.Certificate(`${domain}-certificate`, {
            domainName: domain,
            subjectAlternativeNames: domainsAlt.length > 0 ? domainsAlt : undefined,
            validationMethod: "DNS",
            keyAlgorithm: keyAlgorithm,
            tags: {
                ...generalTags,
                Name: `${domain}-certificate`,
            }
        }, certOps);

        // Create validation records for all domains (main + SANs)
        const validationRecords: aws.route53.Record[] = [];
        const totalDomains = 1 + domainsAlt.length;

        for (let i = 0; i < totalDomains; i++) {
            const validationRecord = new aws.route53.Record(`${domain}-validation-${i}`, {
                name: certificate.domainValidationOptions[i].resourceRecordName,
                zoneId: zone.zoneId.apply(x => x),
                type: certificate.domainValidationOptions[i].resourceRecordType,
                records: [certificate.domainValidationOptions[i].resourceRecordValue],
                ttl: 60 * 60
            });
            validationRecords.push(validationRecord);
        }

        const certValidation = new aws.acm.CertificateValidation(`${domain}-certificateValidation`, {
            certificateArn: certificate.arn,
            validationRecordFqdns: validationRecords.map(record => record.fqdn),
        }, certOps);

        return {certificate, certValidation};
    }

    static async fetchCertificate(
        domain: string,
        keyAlgorithm: CertificateKeyAlgorithm = CertificateKeyAlgorithm.RSA_2048,
        provider?: aws.Provider
    ): Promise<aws.acm.Certificate> {
        const certOps: any = provider ? {provider: provider} : {};

        const certData = await aws.acm.getCertificate({
            domain: domain,
            statuses: ["ISSUED"],
            mostRecent: true,
            keyTypes: [keyAlgorithm],
        }, certOps);

        return aws.acm.Certificate.get(
            `${domain}-certificate-fetched`,
            certData.arn,
            undefined,
            certOps
        );
    }

    static getSgByExportedId(sgIds: pulumi.Output<any>, alias: string, project: string): pulumi.Output<aws.ec2.SecurityGroup> {
        return sgIds.apply(id =>
            aws.ec2.SecurityGroup.get(`${project}-${alias.toLowerCase()}-sg`, id[alias])
        );
    }
}

export {UtilsInfra}