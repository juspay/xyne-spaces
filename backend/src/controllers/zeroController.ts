import { Response, type Request } from 'express';
import { 
  handleMutate, 
  handleQueries,
} from '../zero/server.js';

export const handlePush = async (req: Request, res: Response): Promise<void> => {
    try {
      // Convert Express request to Web API Request
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const headers = new Headers();

      Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers.set(key, value);
        } else if (Array.isArray(value)) {
          headers.set(key, value.join(', '));
        }
      });

      // Add token from cookie to Authorization header for Zero
      if (req.cookies?.google_access_token) {
        headers.set('authorization', `Bearer ${req.cookies.google_access_token}`);
      }

      const webRequest = new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

      const result = await handleMutate(webRequest);

      res.json(result);
    } catch (error) {

      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }


export const handleGetQueries = async (req: Request, res: Response): Promise<void> => {
    try {
      // Convert Express request to Web API Request
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const headers = new Headers();

      Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers.set(key, value);
        } else if (Array.isArray(value)) {
          headers.set(key, value.join(', '));
        }
      });

      // Add token from cookie to Authorization header for Zero
      if (req.cookies?.google_access_token) {
        headers.set('authorization', `Bearer ${req.cookies.google_access_token}`);
      }

      const webRequest = new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

      const result = await handleQueries(webRequest);

      res.json(result);
    } catch (error) {

      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }