import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import {
  AdminServiceRequestQuery,
  ApproveServiceRequestDto,
  CompleteServiceRequestDto,
  DeclineServiceRequestDto,
  InformationRequestDto,
  InsurerUpdateDto,
  ReplyDto,
  ServiceRequestQuery,
  SubmitServiceRequestDto,
  WithdrawDto,
} from './dto/service-request.dto.js';
import { ServiceRequestsService } from './service-requests.service.js';

function customerOf(principal: Principal): CustomerPrincipal {
  if (principal.kind !== 'customer') throw ApiException.forbidden('This endpoint is for customer accounts.');
  return principal;
}

/** The customer's own requests about the policies they hold. */
@Controller('service-requests')
export class CustomerServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Needs('service-request:submit')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiRateLimit(API_LIMITS.customerWrite)
  submit(@Body() dto: SubmitServiceRequestDto, @CurrentUser() principal: Principal) {
    return this.requests.submit(customerOf(principal), dto);
  }

  @Needs('service-request:read')
  @Get()
  list(@CurrentUser() principal: Principal) {
    return this.requests.listMine(customerOf(principal));
  }

  @Needs('service-request:read')
  @Get(':reference')
  @ApiRateLimit(API_LIMITS.bulkRead)
  get(@Param('reference') reference: string, @CurrentUser() principal: Principal) {
    return this.requests.getMine(customerOf(principal), reference);
  }

  @Needs('service-request:submit')
  @Post(':reference/reply')
  @HttpCode(HttpStatus.OK)
  @ApiRateLimit(API_LIMITS.customerWrite)
  reply(@Param('reference') reference: string, @Body() dto: ReplyDto, @CurrentUser() principal: Principal) {
    return this.requests.reply(customerOf(principal), reference, dto);
  }

  @Needs('service-request:submit')
  @Post(':reference/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiRateLimit(API_LIMITS.customerWrite)
  withdraw(@Param('reference') reference: string, @Body() dto: WithdrawDto, @CurrentUser() principal: Principal) {
    return this.requests.withdraw(customerOf(principal), reference, dto);
  }
}

/** The insurer's queue: requests about its own policies only. */
@Controller('insurer/service-requests')
export class InsurerServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Needs('portal:service-request:read')
  @Get()
  list(@Query() query: ServiceRequestQuery, @CurrentUser() principal: Principal) {
    return this.requests.listForInsurer(principal, query.status);
  }

  @Needs('portal:service-request:read')
  @Get(':reference')
  @ApiRateLimit(API_LIMITS.bulkRead)
  get(@Param('reference') reference: string, @CurrentUser() principal: Principal) {
    return this.requests.getForInsurer(principal, reference);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/review')
  @HttpCode(HttpStatus.OK)
  review(@Param('reference') reference: string, @CurrentUser() principal: Principal) {
    return this.requests.review(principal, reference);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/information-requests')
  @HttpCode(HttpStatus.OK)
  requestInformation(@Param('reference') reference: string, @Body() dto: InformationRequestDto, @CurrentUser() principal: Principal) {
    return this.requests.requestInformation(principal, reference, dto);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/updates')
  @HttpCode(HttpStatus.OK)
  postUpdate(@Param('reference') reference: string, @Body() dto: InsurerUpdateDto, @CurrentUser() principal: Principal) {
    return this.requests.postUpdate(principal, reference, dto);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/decline')
  @HttpCode(HttpStatus.OK)
  decline(@Param('reference') reference: string, @Body() dto: DeclineServiceRequestDto, @CurrentUser() principal: Principal) {
    return this.requests.decline(principal, reference, dto);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('reference') reference: string, @Body() dto: ApproveServiceRequestDto, @CurrentUser() principal: Principal) {
    return this.requests.approve(principal, reference, dto);
  }

  @Needs('portal:service-request:manage')
  @Post(':reference/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('reference') reference: string, @Body() dto: CompleteServiceRequestDto, @CurrentUser() principal: Principal) {
    return this.requests.complete(principal, reference, dto);
  }
}

/** InsurShield reads every request, for support; it decides none of them. */
@Controller('admin/service-requests')
export class AdminServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Needs('admin:service-request:read')
  @Get()
  list(@Query() query: AdminServiceRequestQuery) {
    return this.requests.listAll(query);
  }

  @Needs('admin:service-request:read')
  @Get(':reference')
  get(@Param('reference') reference: string) {
    return this.requests.getAny(reference);
  }
}
