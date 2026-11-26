import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import * as tables from '../db/schema.js';

const {
  customers, vehicles, consentRecords, marketingConsents, contactPreferences, quoteRequests,
  quoteRequestProductVersions, quoteRequestProductRequirementAnswers, quoteRequestProductRequirementDeclarations,
  quoteRequestProductRequirementDocuments, insurerQuotes, insurers, policies, payments, paymentRefunds,
  serviceRequests, serviceRequestUpdates, claimNotifications, claimUpdates, ncdApplications, inspections, notifications,
} = tables;

@Injectable()
export class AccountDataRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  snapshot<T>(work: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(work, { isolationLevel: 'repeatable read' });
  }

  async profile(tx: Transaction, id: string) {
    const [profile] = await tx.select({
      id: customers.id, fullName: customers.fullName, email: customers.email, phone: customers.phone,
      emailVerifiedAt: customers.emailVerifiedAt, createdAt: customers.createdAt,
    }).from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    return profile;
  }

  async preferences(tx: Transaction, id: string) {
    const consents = await tx.select({
      privacyVersion: consentRecords.privacyVersion, termsVersion: consentRecords.termsVersion, acceptedAt: consentRecords.acceptedAt,
    }).from(consentRecords).where(eq(consentRecords.customerId, id)).orderBy(asc(consentRecords.acceptedAt));
    const marketingConsent = await tx.select({
      granted: marketingConsents.granted, noticeVersion: marketingConsents.noticeVersion, purpose: marketingConsents.purpose,
      recordedAt: marketingConsents.recordedAt,
    }).from(marketingConsents).where(eq(marketingConsents.customerId, id)).orderBy(asc(marketingConsents.recordedAt));
    const preferences = await tx.select({
      category: contactPreferences.category, channel: contactPreferences.channel,
      enabled: contactPreferences.enabled, updatedAt: contactPreferences.updatedAt,
    }).from(contactPreferences).where(eq(contactPreferences.customerId, id)).orderBy(asc(contactPreferences.category), asc(contactPreferences.channel));
    return { consents, marketingConsent, contactPreferences: preferences };
  }

  vehicles(tx: Transaction, id: string) {
    return tx.select({
      id: vehicles.id, plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model, year: vehicles.year,
      color: vehicles.color, chassisNumber: vehicles.chassisNumber, engineNumber: vehicles.engineNumber,
      registrationDate: vehicles.registrationDate, registrationCountry: vehicles.registrationCountry,
      rtsaAnniversaryDate: vehicles.rtsaAnniversaryDate,
    }).from(vehicles).where(or(
      exists(tx.select({ one: sql`1` }).from(quoteRequests)
        .where(and(eq(quoteRequests.vehicleId, vehicles.id), eq(quoteRequests.customerId, id)))),
      exists(tx.select({ one: sql`1` }).from(policies)
        .where(and(eq(policies.vehicleId, vehicles.id), eq(policies.customerId, id)))),
    )).orderBy(asc(vehicles.createdAt), asc(vehicles.id));
  }

  async quoteRecords(tx: Transaction, id: string) {
    const requests = await tx.select({
      id: quoteRequests.id, vehicleId: quoteRequests.vehicleId, status: quoteRequests.status,
      vehicleValueMinor: quoteRequests.vehicleValueMinor, vehicleUsage: quoteRequests.vehicleUsage, insuranceType: quoteRequests.insuranceType,
      coverageDuration: quoteRequests.coverageDuration, matchRtsaAnniversary: quoteRequests.matchRtsaAnniversary,
      policyStartDate: quoteRequests.policyStartDate, policyEndDate: quoteRequests.policyEndDate, coverageDays: quoteRequests.coverageDays,
      whiteBookDocumentId: quoteRequests.whiteBookDocumentId, ncdPercentage: quoteRequests.ncdPercentage,
      submittedAt: quoteRequests.submittedAt, expiresAt: quoteRequests.expiresAt,
      requotedFromId: quoteRequests.requotedFromId, renewalOfPolicyNumber: quoteRequests.renewalOfPolicyNumber,
    }).from(quoteRequests).where(eq(quoteRequests.customerId, id)).orderBy(asc(quoteRequests.submittedAt), asc(quoteRequests.id));
    const products = await tx.select({
      quoteRequestId: quoteRequestProductVersions.quoteRequestId, productVersionId: quoteRequestProductVersions.productVersionId,
      insurer: insurers.name, productName: quoteRequestProductVersions.productName, version: quoteRequestProductVersions.productVersionNumber,
      status: quoteRequestProductVersions.status, selectedAt: quoteRequestProductVersions.selectedAt,
      coverGuide: quoteRequestProductVersions.coverGuide, replyDueAt: quoteRequestProductVersions.replyDueAt,
      declineReasonCode: quoteRequestProductVersions.declineReasonCode, declineCustomerNote: quoteRequestProductVersions.declineCustomerNote,
    }).from(quoteRequestProductVersions).innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductVersions.quoteRequestId))
      .innerJoin(insurers, eq(insurers.id, quoteRequestProductVersions.insurerId)).where(eq(quoteRequests.customerId, id));
    const answers = await tx.select({
      quoteRequestId: quoteRequestProductRequirementAnswers.quoteRequestId, productVersionId: quoteRequestProductRequirementAnswers.productVersionId,
      requirementKey: quoteRequestProductRequirementAnswers.requirementKey, value: quoteRequestProductRequirementAnswers.value,
    }).from(quoteRequestProductRequirementAnswers).innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductRequirementAnswers.quoteRequestId))
      .where(eq(quoteRequests.customerId, id));
    const declarations = await tx.select({
      quoteRequestId: quoteRequestProductRequirementDeclarations.quoteRequestId, productVersionId: quoteRequestProductRequirementDeclarations.productVersionId,
      requirementKey: quoteRequestProductRequirementDeclarations.requirementKey, acceptedAt: quoteRequestProductRequirementDeclarations.acceptedAt,
    }).from(quoteRequestProductRequirementDeclarations).innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductRequirementDeclarations.quoteRequestId))
      .where(eq(quoteRequests.customerId, id));
    const evidence = await tx.select({
      quoteRequestId: quoteRequestProductRequirementDocuments.quoteRequestId, productVersionId: quoteRequestProductRequirementDocuments.productVersionId,
      requirementKey: quoteRequestProductRequirementDocuments.requirementKey, documentId: quoteRequestProductRequirementDocuments.documentId,
    }).from(quoteRequestProductRequirementDocuments).innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductRequirementDocuments.quoteRequestId))
      .where(eq(quoteRequests.customerId, id));
    const quotations = await tx.select({
      id: insurerQuotes.id, quoteRequestId: insurerQuotes.quoteRequestId, insurer: insurers.name, productVersionId: insurerQuotes.productVersionId,
      insurerReference: insurerQuotes.insurerReference, premiumMinor: insurerQuotes.premiumMinor, excessMinor: insurerQuotes.excessMinor,
      componentsMinor: insurerQuotes.componentsMinor, addOns: insurerQuotes.addOns, conditions: insurerQuotes.conditions,
      documentId: insurerQuotes.documentId, status: insurerQuotes.status, issuedAt: insurerQuotes.sentAt, validUntil: insurerQuotes.validUntil,
    }).from(insurerQuotes).innerJoin(quoteRequests, eq(quoteRequests.id, insurerQuotes.quoteRequestId))
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId)).where(eq(quoteRequests.customerId, id)).orderBy(asc(insurerQuotes.sentAt));
    return { requests, products, answers, declarations, evidence, quotations };
  }

  async financialRecords(tx: Transaction, id: string) {
    const held = await tx.select({
      policyNumber: policies.policyNumber, insurerPolicyNumber: policies.insurerPolicyNumber, insurer: insurers.name, status: policies.status,
      quoteRequestId: policies.quoteRequestId, vehicleId: policies.vehicleId, productVersionId: policies.productVersionId,
      coverage: policies.coverage, plan: policies.plan, premiumMinor: policies.premiumMinor, startDate: policies.policyStartDate,
      endDate: policies.policyEndDate, issuedAt: policies.issuedAt, cancelledAt: policies.cancelledAt,
      quoteDocumentId: policies.quoteDocumentId, certificateDocumentId: policies.certificateDocumentId,
    }).from(policies).innerJoin(insurers, eq(insurers.id, policies.insurerId)).where(eq(policies.customerId, id)).orderBy(asc(policies.receivedAt));
    const paid = await tx.select({
      transactionId: payments.transactionId, quoteRequestId: payments.quoteRequestId, status: payments.status, method: payments.method,
      amountMinor: payments.amountMinor, currency: payments.currency, payerMasked: payments.payerMsisdnMasked, confirmedAt: payments.confirmedAt,
      amountBreakdown: payments.amountBreakdown, createdAt: payments.createdAt,
    }).from(payments).where(eq(payments.customerId, id)).orderBy(asc(payments.createdAt));
    const refunds = await tx.select({
      transactionId: payments.transactionId, amountMinor: paymentRefunds.amountMinor, currency: payments.currency,
      status: paymentRefunds.status, completedAt: paymentRefunds.completedAt,
    }).from(paymentRefunds).innerJoin(payments, eq(payments.id, paymentRefunds.paymentId)).where(eq(payments.customerId, id));
    return { policies: held, payments: paid, refunds };
  }

  async serviceRecords(tx: Transaction, id: string) {
    const requests = await tx.select({
      reference: serviceRequests.reference, policyNumber: serviceRequests.policyNumber, insurer: insurers.name, type: serviceRequests.type,
      status: serviceRequests.status, reason: serviceRequests.reason, requestedEffectiveDate: serviceRequests.requestedEffectiveDate,
      effectiveDate: serviceRequests.effectiveDate, decision: serviceRequests.decision, decisionNote: serviceRequests.decisionNote,
      refundAmountMinor: serviceRequests.refundAmountMinor, decidedAt: serviceRequests.decidedAt,
      completedAt: serviceRequests.completedAt, createdAt: serviceRequests.createdAt, updatedAt: serviceRequests.updatedAt,
    }).from(serviceRequests).innerJoin(insurers, eq(insurers.id, serviceRequests.insurerId))
      .where(eq(serviceRequests.customerId, id)).orderBy(asc(serviceRequests.createdAt));
    const updates = await tx.select({
      reference: serviceRequestUpdates.reference, author: serviceRequestUpdates.authorKind, message: serviceRequestUpdates.message,
      statusFrom: serviceRequestUpdates.statusFrom, statusTo: serviceRequestUpdates.statusTo,
      documentIds: serviceRequestUpdates.documentIds, createdAt: serviceRequestUpdates.createdAt,
    }).from(serviceRequestUpdates).innerJoin(serviceRequests, eq(serviceRequests.reference, serviceRequestUpdates.reference))
      .where(and(eq(serviceRequests.customerId, id), eq(serviceRequestUpdates.visibleToCustomer, true))).orderBy(asc(serviceRequestUpdates.createdAt));
    return { requests, updates };
  }

  async otherRecords(tx: Transaction, id: string) {
    const claims = await tx.select({
      claimNumber: claimNotifications.claimNumber, policyNumber: claimNotifications.policyNumber, insurer: insurers.name,
      status: claimNotifications.status, vehiclePlate: claimNotifications.plate, vehicle: claimNotifications.vehicleLabel,
      type: claimNotifications.type, incidentDate: claimNotifications.incidentDate, location: claimNotifications.location,
      description: claimNotifications.description, estimatedLossMinor: claimNotifications.estimatedLossMinor, policeReport: claimNotifications.policeReport,
      policeReportNumber: claimNotifications.policeReportNumber, lateReason: claimNotifications.lateReason,
      submittedAt: claimNotifications.submittedAt, receivedAt: claimNotifications.receivedAt, insurerClaimReference: claimNotifications.insurerClaimReference,
      responseDueOn: claimNotifications.responseDueOn, lateSubmission: claimNotifications.lateSubmission,
    }).from(claimNotifications).innerJoin(insurers, eq(insurers.id, claimNotifications.insurerId))
      .where(eq(claimNotifications.customerId, id)).orderBy(asc(claimNotifications.submittedAt));
    const claimTimeline = await tx.select({
      claimNumber: claimUpdates.claimNumber, status: claimUpdates.status, author: claimUpdates.actorKind,
      message: claimUpdates.message, evidenceRequest: claimUpdates.evidenceRequest, createdAt: claimUpdates.createdAt,
    }).from(claimUpdates).innerJoin(claimNotifications, eq(claimNotifications.claimNumber, claimUpdates.claimNumber))
      .where(eq(claimNotifications.customerId, id)).orderBy(asc(claimUpdates.createdAt), asc(claimUpdates.id));
    const ncd = await tx.select({
      applicationNumber: ncdApplications.applicationNumber, policyNumber: ncdApplications.policyNumber, insurer: insurers.name,
      yearsClaimFree: ncdApplications.yearsClaimFree, status: ncdApplications.status, submittedAt: ncdApplications.submittedAt, decidedAt: ncdApplications.decidedAt,
      declarationAcceptedAt: ncdApplications.declarationAcceptedAt, declarationVersion: ncdApplications.declarationVersion,
      decisionNote: ncdApplications.decisionNote,
    }).from(ncdApplications).innerJoin(insurers, eq(insurers.id, ncdApplications.insurerId)).where(eq(ncdApplications.customerId, id));
    const visits = await tx.select({
      id: inspections.id, insurer: insurers.name, status: inspections.status, purpose: inspections.purpose,
      policyNumber: inspections.policyNumber, claimNumber: inspections.claimNumber, predecessorId: inspections.predecessorId,
      vehiclePlate: inspections.vehiclePlate, vehicle: inspections.vehicleLabel, preferredDate: inspections.preferredDate,
      preferredTime: inspections.preferredTime, preferredLocation: inspections.preferredLocation, scheduledDate: inspections.scheduledDate,
      location: inspections.location, result: inspections.result, resultReason: inspections.resultReason, createdAt: inspections.createdAt,
    }).from(inspections).leftJoin(insurers, eq(insurers.id, inspections.insurerId)).where(eq(inspections.customerId, id));
    const notices = await tx.select({
      template: notifications.templateKey, channel: notifications.channel, category: notifications.category, subject: notifications.subject,
      body: notifications.body, entityType: notifications.entityType, entityId: notifications.entityId, readAt: notifications.readAt,
      deliveryStatus: notifications.deliveryStatus, deliveredAt: notifications.deliveredAt, createdAt: notifications.createdAt,
    }).from(notifications).where(eq(notifications.customerId, id)).orderBy(asc(notifications.createdAt));
    return { claims, claimTimeline, ncdApplications: ncd, inspections: visits, notifications: notices };
  }
}
