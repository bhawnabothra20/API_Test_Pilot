import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EndpointSpec, HttpMethod, JsonSchema } from '../../shared/helpers/types';
import { buildResources } from '../../scripts/discover';
import { fixtureSummary } from './fixtures';

const base = fixtureSummary('d').endpoints[0];
const PET: JsonSchema = { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['name'] };
const USER: JsonSchema = { type: 'object', properties: { id: { type: 'integer' }, username: { type: 'string' } } };
const RESULT: JsonSchema = { type: 'object', properties: { code: { type: 'integer' }, message: { type: 'string' } } };

function ep(method: HttpMethod, path: string, extra: Partial<EndpointSpec> = {}): EndpointSpec {
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: 'path' as const, required: true, schema: { type: 'string' as const } }));
  return { ...base, id: `${path}_${method}`, group: path.split('/')[1], method, path, pathParams: params, responseSchema: undefined, requestBody: undefined, ...extra };
}

describe('discover: buildResources', () => {
  // PetStore order: the action paths come BEFORE the real collections
  const endpoints = [
    ep('POST', '/pet/{petId}/uploadImage', { responseSchema: RESULT }),
    ep('POST', '/pet', { requestBody: { contentType: 'application/json', schema: PET }, responseSchema: PET }),
    ep('GET', '/pet/{petId}', { responseSchema: PET }),
    ep('DELETE', '/pet/{petId}'),
    ep('POST', '/user/createWithList', { responseSchema: RESULT }),
    ep('POST', '/user', { requestBody: { contentType: 'application/json', schema: USER }, responseSchema: RESULT }),
    ep('GET', '/user/{username}', { responseSchema: USER }),
  ];
  const resources = buildResources(endpoints);
  const byName = Object.fromEntries(resources.map((r) => [r.name, r]));

  test('the CRUD collection wins over action paths listed earlier in the spec', () => {
    assert.equal(byName.pet.collectionPath, '/pet');
    assert.equal(byName.pet.itemPath, '/pet/{petId}');
    assert.equal(byName.user.collectionPath, '/user');
    assert.equal(byName.user.itemPath, '/user/{username}');
  });

  test('the path parameter names the id field when the resource has that field', () => {
    assert.equal(byName.user.idField, 'username', '/user/{username} is identified by username');
    assert.equal(byName.pet.idField, 'id', 'petId is not a Pet field, so id stays');
    assert.equal(byName.pet.createIdPath, 'id');
  });

  test('one resource per group', () => {
    assert.deepEqual(resources.map((r) => r.name).sort(), ['pet', 'user']);
  });
});
