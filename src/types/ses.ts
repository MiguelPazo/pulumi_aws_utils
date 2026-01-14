/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type SesDmarcPolicy = {
    policy: "none" | "quarantine" | "reject";
    reportEmail?: string;
    percentage?: number;
    dkimAlignment?: "r" | "s";
    spfAlignment?: "r" | "s";
};

export type SesModuleConfig = {
    name: string;
    zone: aws.route53.Zone;
    domain: string;
    configurationSetName?: string;
    dmarcPolicy?: SesDmarcPolicy;
};

export type SesResult = {
    domainIdentity: aws.ses.DomainIdentity;
    domainDkim: aws.ses.DomainDkim;
    configurationSet?: aws.ses.ConfigurationSet;
};
