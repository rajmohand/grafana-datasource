// Copyright (c) 2022 Grafana Labs
// A detailed history of changes can be seen this - https://github.com/VictoriaMetrics/grafana-datasource
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { Registry } from '@grafana/data';

import { PromVisualQueryOperationCategory } from '../types';

import { QueryBuilderLabelFilter, QueryBuilderOperation, QueryBuilderOperationDef, VisualQueryModeller } from './types';

export interface VisualQueryBinary<T> {
  operator: string;
  vectorMatchesType?: 'on' | 'ignoring';
  vectorMatches?: string;
  query: T;
}

export interface PromLokiVisualQuery {
  metric?: string;
  labels: QueryBuilderLabelFilter[];
  operations: QueryBuilderOperation[];
  binaryQueries?: Array<VisualQueryBinary<PromLokiVisualQuery>>;
}

export abstract class LokiAndPromQueryModellerBase implements VisualQueryModeller {
  protected operationsRegistry: Registry<QueryBuilderOperationDef>;
  private categories: string[] = [];

  constructor(getOperations: () => QueryBuilderOperationDef[]) {
    this.operationsRegistry = new Registry<QueryBuilderOperationDef>(getOperations);
  }

  protected setOperationCategories(categories: string[]) {
    this.categories = categories;
  }

  getOperationsForCategory(category: string) {
    return this.operationsRegistry.list().filter((op) => op.category === category && !op.hideFromList);
  }

  getAlternativeOperations(key: string) {
    return this.operationsRegistry.list().filter((op) => op.alternativesKey && op.alternativesKey === key);
  }

  getCategories() {
    return this.categories;
  }

  getOperationDef(id: string): QueryBuilderOperationDef | undefined {
    return this.operationsRegistry.getIfExists(id);
  }

  renderOperations(queryString: string, operations: QueryBuilderOperation[]) {
    for (const operation of operations) {
      const def = this.operationsRegistry.getIfExists(operation.id);
      if (!def) {
        throw new Error(`Could not find operation ${operation.id} in the registry`);
      }
      queryString = def.renderer(operation, def, queryString);
    }

    return queryString;
  }

  renderBinaryQueries(queryString: string, binaryQueries?: Array<VisualQueryBinary<PromLokiVisualQuery>>) {
    if (binaryQueries) {
      for (const binQuery of binaryQueries) {
        queryString = `${this.renderBinaryQuery(queryString, binQuery)}`;
      }
    }
    return queryString;
  }

  private renderBinaryQuery(leftOperand: string, binaryQuery: VisualQueryBinary<PromLokiVisualQuery>) {
    let result = leftOperand + ` ${binaryQuery.operator} `;

    if (binaryQuery.vectorMatches) {
      result += `${binaryQuery.vectorMatchesType}(${binaryQuery.vectorMatches}) `;
    }

    return result + this.renderQuery(binaryQuery.query, true);
  }

  renderLabels(labels: QueryBuilderLabelFilter[]) {
    if (labels.length === 0) {
      return '';
    }

    let expr = '{';
    for (const filter of labels) {
      if (expr !== '{') {
        expr += ', ';
      }

      expr += `${filter.label}${filter.op}"${filter.value}"`;
    }

    return expr + `}`;
  }

  renderQuery(query: PromLokiVisualQuery, nested?: boolean) {
    let queryString = `${query.metric ?? ''}${this.renderLabels(query.labels)}`;
    queryString = this.renderOperations(queryString, query.operations);

    if (!nested && this.hasBinaryOp(query) && Boolean(query.binaryQueries?.length)) {
      queryString = `(${queryString})`;
    }

    queryString = this.renderBinaryQueries(queryString, query.binaryQueries);

    if (nested && (this.hasBinaryOp(query) || Boolean(query.binaryQueries?.length))) {
      queryString = `(${queryString})`;
    }

    return queryString;
  }

  hasBinaryOp(query: PromLokiVisualQuery): boolean {
    return (
      query.operations.find((op) => {
        const def = this.getOperationDef(op.id);
        return def?.category === PromVisualQueryOperationCategory.BinaryOps;
      }) !== undefined
    );
  }
}
