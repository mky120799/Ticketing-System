/**
 * Prints the order in which NestJS runs each part of a request.
 * Run from the repository root:
 *   cd docs/learn-nestjs/examples && npx tsx --tsconfig tsconfig.json lifecycle-demo.ts
 * It starts a tiny app in memory (no network, no database) and sends two requests: one that succeeds and one that fails.
 */
import 'reflect-metadata';
import { ArgumentsHost, BadRequestException, CallHandler, CanActivate, Catch, Controller, ExceptionFilter, ExecutionContext, ForbiddenException, Get, HttpException, Inject, Injectable, MiddlewareConsumer, Module, NestInterceptor, NestModule, PipeTransform, Query, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { tap } from 'rxjs';

const steps: string[] = [];
const log = (step: string) => steps.push(step);

function demoMiddleware(_req: unknown, _res: unknown, next: () => void): void { log('2. middleware'); next(); }

@Injectable() class DemoGuard implements CanActivate { canActivate(): boolean { log('3. guard'); return true; } }

@Injectable() class DemoInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    log('4. interceptor (before the method)');
    return next.handle().pipe(tap({ next: () => log('8. interceptor (after the method, on success)'), error: () => log('8. interceptor (after, on error)') }));
  }
}

@Injectable() class DemoPipe implements PipeTransform {
  transform(value: string) { log('5. pipe'); if (value === 'bad') throw new BadRequestException('the pipe rejected the value'); return value; }
}

@Catch(HttpException) class DemoFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    log('9. exception filter (turns the error into the response)');
    host.switchToHttp().getResponse().status(exception.getStatus()).send({ handledBy: 'DemoFilter', message: exception.message });
  }
}

@Injectable() class DemoService { work(mode: string): string { log('7. service'); if (mode === 'forbidden') throw new ForbiddenException('the service refused'); return 'done'; } }

@Controller('demo')
@UseGuards(DemoGuard) @UseInterceptors(DemoInterceptor) @UseFilters(DemoFilter)
class DemoController {
  // Normally the constructor type alone is enough (Lesson 3). tsx does not write that type note, so we name the provider explicitly with @Inject.
  constructor(@Inject(DemoService) private readonly service: DemoService) {}
  @Get() run(@Query('mode', DemoPipe) mode: string) { log('6. controller method'); return { result: this.service.work(mode) }; }
}

@Module({ controllers: [DemoController], providers: [{ provide: DemoService, useClass: DemoService }] })
class DemoModule implements NestModule { configure(consumer: MiddlewareConsumer) { consumer.apply(demoMiddleware).forRoutes(DemoController); } }

async function main(): Promise<void> {
  const adapter = new FastifyAdapter();
  adapter.getInstance().addHook('onRequest', (_request, _reply, done) => { log('1. Fastify onRequest hook (before NestJS)'); done(); });
  const app = await NestFactory.create<NestFastifyApplication>(DemoModule, adapter, { logger: false });
  await app.init(); await app.getHttpAdapter().getInstance().ready();

  for (const [title, url] of [['SUCCESS', '/demo?mode=ok'], ['PIPE REJECTS', '/demo?mode=bad'], ['SERVICE REFUSES', '/demo?mode=forbidden']] as const) {
    steps.length = 0;
    const response = await app.inject({ method: 'GET', url });
    console.log(`\n=== ${title}: GET ${url} -> ${response.statusCode} ${response.body}`);
    for (const step of steps) console.log('   ', step);
  }
  await app.close();
}
void main();
