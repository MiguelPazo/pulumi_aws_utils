"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UtilsInfra = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
class UtilsInfra {
    static createAliasRecord(domainCert, targetDnsName, targetZoneId, evaluateTargetHealth) {
        pulumi.all([domainCert.domain, domainCert.zoneId, targetDnsName, targetZoneId]).apply(x => {
            this.createAliasRecordDirect(x[0], x[1], x[2], x[3], evaluateTargetHealth);
        });
    }
    static createAliasRecordDirect(domain, zoneId, targetDnsName, targetZoneId, evaluateTargetHealth) {
        evaluateTargetHealth = evaluateTargetHealth !== false;
        new aws.route53.Record(`${domain}-alb-record`, {
            name: `${domain}.`,
            zoneId: zoneId,
            type: aws.route53.RecordTypes.A,
            aliases: [
                {
                    name: targetDnsName,
                    zoneId: targetZoneId,
                    evaluateTargetHealth: evaluateTargetHealth
                },
            ],
        });
    }
    static async createCertificate(domain, zone, generalTags, provider) {
        const certOps = provider ? { provider: provider } : {};
        const certValidOps = provider ? { provider: provider } : {};
        const certificate = new aws.acm.Certificate(`${domain}-certificate`, {
            domainName: domain,
            validationMethod: "DNS",
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
        }, certValidOps);
        return { certificate, certValidation };
    }
}
exports.UtilsInfra = UtilsInfra;
//# sourceMappingURL=UtilsInfra.js.map