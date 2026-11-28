import type { OperationsUseCases } from '../../application/use-cases/OperationsUseCases.js';
import type { StateRepository } from '../../application/ports/StateRepository.js';

/** Dependencias que reciben los módulos de rutas. */
export type RouteContext = {
  ops: OperationsUseCases;
  repo: StateRepository;
};
