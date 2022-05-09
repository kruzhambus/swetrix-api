import { 
  Controller, Query, Req, Body, Param, Get, Post, Put, Delete, HttpCode, BadRequestException, UseGuards, MethodNotAllowedException,
} from '@nestjs/common'
import { Request } from 'express'
import { ApiTags, ApiQuery } from '@nestjs/swagger'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as _map from 'lodash/map'
import * as _join from 'lodash/join'
import * as _isNull from 'lodash/isNull'
import * as _isEmpty from 'lodash/isEmpty'

import { UserService } from './user.service'
import { ProjectService } from '../project/project.service'
import {
  User, UserType, MAX_EMAIL_REQUESTS, PlanCode,
} from './entities/user.entity'
import { Roles } from '../common/decorators/roles.decorator'
import { Pagination } from '../common/pagination/pagination'
import {
  GDPR_EXPORT_TIMEFRAME, clickhouse,
} from '../common/constants'
import { RolesGuard } from 'src/common/guards/roles.guard'
import { SelfhostedGuard } from '../common/guards/selfhosted.guard'
import { UpdateUserProfileDTO } from './dto/update-user.dto'
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator'
import { ActionTokensService } from '../action-tokens/action-tokens.service'
import { MailerService } from '../mailer/mailer.service'
import { ActionTokenType } from '../action-tokens/action-token.entity'
import { AuthService } from '../auth/auth.service'
import { LetterTemplate } from 'src/mailer/letter'
import { AppLoggerService } from 'src/logger/logger.service'
import { UserProfileDTO } from './dto/user.dto'

dayjs.extend(utc)

@ApiTags('User')
@Controller('user')
@UseGuards(RolesGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly projectService: ProjectService,
    private readonly actionTokensService: ActionTokensService,
    private readonly mailerService: MailerService,
    private readonly logger: AppLoggerService,
  ) {}

  @Get('/')
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.ADMIN)
  async get(@Query('take') take: number | undefined, @Query('skip') skip: number | undefined): Promise<Pagination<User> | User[]> {
    this.logger.log({ take, skip }, 'GET /user')
    const users = await this.userService.paginate({ take, skip })
    const usersResults: any = users.results.map((e) => {
      return this.authService.processUser(e)
    })
    users.results = usersResults
    return users
  }

  @Get('/search')
  @ApiQuery({ name: 'query', required: false })
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.ADMIN)
  async searchUsers(@Query('query') query: string | undefined): Promise<User[]> {
    this.logger.log({ query }, 'GET /user/search')
    return await this.userService.search(query)
  }

  @Post('/')
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.ADMIN)
  async create(@Body() userDTO: UserProfileDTO): Promise<User> {
    this.logger.log({ userDTO }, 'POST /user')
    this.userService.validatePassword(userDTO.password)
    userDTO.password = await this.authService.hashPassword(userDTO.password)

    try {
      const user = await this.userService.create({ ...userDTO, isActive: true })
      return user
    } catch(e) {
      if (e.code === 'ER_DUP_ENTRY'){
        if(e.sqlMessage.includes(userDTO.email)) {
          throw new BadRequestException('User with this email already exists')
        }
      }
    }
  }

  @Delete('/:id')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.ADMIN)
  async delete(@Param('id') id: string, @CurrentUserId() uid: string): Promise<any> {
    this.logger.log({ id, uid }, 'DELETE /user/:id')
    const user = await this.userService.findOne(id, {
      relations: ['projects'],
      select: ['id', 'planCode'],
    })

    if (_isEmpty(user)) {
      throw new BadRequestException(`User with id ${id} does not exist`)
    }

    if (user.planCode !== PlanCode.free) {
      throw new BadRequestException('cancelSubFirst')
    }

    try {
      if (!_isEmpty(user.projects)) {
        const pids = _join(_map(user.projects, el => `'${el.id}'`), ',')
        const query1 = `ALTER table analytics DELETE WHERE pid IN (${pids})`
        const query2 = `ALTER table customEV DELETE WHERE pid IN (${pids})`
        await this.projectService.deleteMultiple(pids)
        await clickhouse.query(query1).toPromise()
        await clickhouse.query(query2).toPromise()
      }
      await this.userService.delete(id)

      return 'accountDeleted'
    } catch(e) {
      this.logger.error(e)
      throw new BadRequestException('accountDeleteError')
    }
  }

  @Delete('/')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async deleteSelf(@CurrentUserId() id: string): Promise<any> {
    this.logger.log({ id }, 'DELETE /user')

    const user = await this.userService.findOne(id, {
      relations: ['projects'],
      select: ['id', 'planCode'],
    })

    if (user.planCode !== PlanCode.free) {
      throw new BadRequestException('cancelSubFirst')
    }

    try {
      if (!_isEmpty(user.projects)) {
        const pids = _join(_map(user.projects, el => `'${el.id}'`), ',')
        const query1 = `ALTER table analytics DELETE WHERE pid IN (${pids})`
        const query2 = `ALTER table customEV DELETE WHERE pid IN (${pids})`
        await this.projectService.deleteMultiple(pids)
        await clickhouse.query(query1).toPromise()
        await clickhouse.query(query2).toPromise()
      }
      await this.userService.delete(id)

      return 'accountDeleted'
    } catch(e) {
      this.logger.error(e)
      throw new BadRequestException('accountDeleteError')
    }
  }

  @Post('/confirm_email')
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async sendEmailConfirmation(@CurrentUserId() id: string, @Req() request: Request): Promise<boolean> {
    this.logger.log({ id }, 'POST /confirm_email')

    const user = await this.userService.findOneWhere({ id })

    if (!user || !user.email || user.isActive || user.emailRequests >= MAX_EMAIL_REQUESTS) return false

    const token = await this.actionTokensService.createForUser(user, ActionTokenType.EMAIL_VERIFICATION, user.email)
    const url = `${request.headers.origin}/verify/${token.id}`

    await this.userService.update(id, { emailRequests: 1 + user.emailRequests })
    await this.mailerService.sendEmail(user.email, LetterTemplate.SignUp, { url })
    return true
  }

  @Put('/:id')
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.ADMIN)
  async update(@Body() userDTO: UpdateUserProfileDTO, @Param('id') id: string): Promise<User> {
    this.logger.log({ userDTO, id }, 'DELETE /user/:id')
    
    if (userDTO.password) {
      this.userService.validatePassword(userDTO.password)
      userDTO.password = await this.authService.hashPassword(userDTO.password)
    }
    
    const user = await this.userService.findOneWhere({ id })
    
    try {
      if (!user) {
        await this.userService.create({...userDTO})
      }
      await this.userService.update(id, {...user, ...userDTO})
      return this.userService.findOneWhere({ id })
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY'){
        if (e.sqlMessage.includes(userDTO.email)) {
          throw new BadRequestException('User with this email already exists')
        }
      }
      throw new BadRequestException(e.message)
    }
  }

  @Put('/')
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async updateCurrentUser(@Body() userDTO: UpdateUserProfileDTO, @CurrentUserId() id: string, @Req() request: Request): Promise<User> {
    this.logger.log({ userDTO, id }, 'PUT /user')
    const user = await this.userService.findOneWhere({ id })

    if (userDTO.password?.length > 0) {
      this.userService.validatePassword(userDTO.password)
      userDTO.password = await this.authService.hashPassword(userDTO.password)
      await this.mailerService.sendEmail(userDTO.email, LetterTemplate.PasswordChanged)
    }

    try {
      if (userDTO.email && user.email !== userDTO.email) {
        const userWithByEmail = await this.userService.findOneWhere({ email: userDTO.email })

        if (userWithByEmail) {
          throw new BadRequestException('User with this email already exists')
        }

        const token = await this.actionTokensService.createForUser(user, ActionTokenType.EMAIL_CHANGE, userDTO.email)
        const url = `${request.headers.origin}/change-email/${token.id}`
        await this.mailerService.sendEmail(user.email, LetterTemplate.MailAddressChangeConfirmation, { url })
      }
      await this.userService.update(id, { ...userDTO })

      return this.userService.findOneWhere({ id })
    } catch (e) {
      throw new BadRequestException(e.message)
    }
  }

  @Get('/export')
  @UseGuards(RolesGuard)
  @UseGuards(SelfhostedGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async exportUserData(@CurrentUserId() user_id: string): Promise<User> {
    this.logger.log({ user_id }, 'GET /user/export')
    const user = await this.userService.findOneWhere({ id: user_id })
    const where = Object({ admin: user_id })
    const projects = await this.projectService.findWhere(where)

    if (!_isNull(user.exportedAt) && !dayjs().isAfter(dayjs.utc(user.exportedAt).add(GDPR_EXPORT_TIMEFRAME, 'day'), 'day')) {
      throw new MethodNotAllowedException(`Please, try again later. You can request a GDPR Export only once per ${GDPR_EXPORT_TIMEFRAME} days.`)
    }

    const data = {
      user: {
        ...user,
        created: dayjs(user.created).format('YYYY/MM/DD HH:mm:ss'),
        updated: dayjs(user.updated).format('YYYY/MM/DD HH:mm:ss'),
        exportedAt: _isNull(user.exportedAt) ? '-' : dayjs(user.exportedAt).format('YYYY/MM/DD HH:mm:ss'),
      },
      projects: _map(projects, project => ({
        ...project,
        created: dayjs(project.created).format('YYYY/MM/DD HH:mm:ss'),
        origins: _join(project.origins, ', '),
      }))
    }

    await this.mailerService.sendEmail(user.email, LetterTemplate.GDPRDataExport, data)
    await this.userService.update(user.id, {
      exportedAt: dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
    })

    return user
  }
}
