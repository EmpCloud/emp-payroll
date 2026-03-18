import { Request, Response, NextFunction } from "express";

/** Async route handler wrapper — catches promise rejections and forwards to error middleware */
export function wrap(fn: (req: Request, res: Response) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

/** Type-safe param extraction (Express 5 types params as string | string[]) */
export function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}
