import { Route, Routes } from 'react-router';
import { AppLayout } from './layout/AppLayout';
import { routePreviews } from './routes';
import { ConverterPage } from '../pages/converter/ConverterPage';
import { ApiDocsPage } from '../pages/api-docs/ApiDocsPage';
import { RoutePreview } from '../pages/route-preview/RoutePreview';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ConverterPage />} />
        <Route path="/api-docs" element={<ApiDocsPage />} />
        {routePreviews.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={<RoutePreview title={route.title} description={route.description} />}
          />
        ))}
        <Route
          path="*"
          element={
            <RoutePreview
              title="Сторінку не знайдено"
              description="Перевірте адресу або поверніться до конвертера."
            />
          }
        />
      </Route>
    </Routes>
  );
}
