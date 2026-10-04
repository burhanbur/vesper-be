import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type {
  CreateInstrumentInput,
  CreatePriceInput,
  CreateInvestmentInput,
  ListInstrumentsQuery,
  ListPricesQuery,
} from './investment.schema.js';
import type { InvestmentService } from './investment.service.js';
export function createInvestmentController(service: InvestmentService) {
  const instruments: RequestHandler = async (request, response) => {
    const input = response.locals.validated as ValidatedInput;
    const result = await service.instruments(input.query as ListInstrumentsQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Instrumen berhasil diambil.',
    });
  };
  const createInstrument: RequestHandler = async (request, response) => {
    const input = response.locals.validated as ValidatedInput;
    const data = await service.createInstrument(input.body as CreateInstrumentInput);
    sendSuccess(request, response, {
      data,
      statusCode: 201,
      message: 'Instrumen berhasil dibuat.',
    });
  };
  const prices: RequestHandler = async (request, response) => {
    const input = response.locals.validated as ValidatedInput;
    const result = await service.prices(input.query as ListPricesQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Harga instrumen berhasil diambil.',
    });
  };
  const upsertPrice: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await service.upsertPrice(principal.id, input.body as CreatePriceInput);
    sendSuccess(request, response, { data, message: 'Harga instrumen berhasil disimpan.' });
  };
  const createTransaction: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await service.createTransaction(principal.id, input.body as CreateInvestmentInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data,
      statusCode: 201,
      message: 'Transaksi investasi berhasil dibuat.',
    });
  };
  const holdings: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const { id } = input.params as { id: string };
    const data = await service.holdings(principal.id, id);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Holding berhasil diambil.' });
  };
  const snapshot: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const { id } = input.params as { id: string };
    const { date } = input.query as { date: string };
    const data = await service.snapshot(principal.id, id, date);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Snapshot portfolio berhasil diambil.' });
  };
  return {
    instruments,
    createInstrument,
    prices,
    upsertPrice,
    createTransaction,
    holdings,
    snapshot,
  };
}
