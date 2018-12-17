import {Vector2} from "../math/Vector2";
import {Vector3} from "../math/Vector3";
import {Vector4} from "../math/Vector4";
import {Matrix4} from "../math/Matrix4";
import {Box3} from "../math/Box3";
import {MeshBasicMaterial} from "../materials/MeshBasicMaterial";

// 存储对象池
let _object, _face, _vertex, _sprite,
    _objectPool = [], _facePool = [], _vertexPool = [], _spritePool = [],
    _objectCount = 0, _faceCount = 0, _vertexCount = 0, _spriteCount = 0;

let _vector3 = new Vector3(),
    _vector4 = new Vector4(),
    _clipBox = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
    _boundingBox = new Box3();
let _points3 = new Array(3);

let _viewMatrix = new Matrix4(),
    _viewProjectionMatrix = new Matrix4();

let _modelMatrix,
    _modelViewProjectionMatrix = new Matrix4();

// 渲染对象
let _renderData = {objects: [], elements: []};

class RenderList {
    // 投影顶点
    projectVertex(vertex) {
        let position = vertex.position;
        let positionWorld = vertex.positionWorld;
        let positionScreen = vertex.positionScreen;

        // 三维转二维
        positionWorld.copy(position).applyMatrix4(_modelMatrix);
        positionScreen.copy(positionWorld).applyMatrix4(_viewProjectionMatrix);

        let invW = 1 / positionScreen.w;

        positionScreen.x *= invW;
        positionScreen.y *= invW;
        positionScreen.z *= invW;

        vertex.visible = positionScreen.x >= -1 && positionScreen.x <= 1 && positionScreen.y >= -1 && positionScreen.y <= 1 && positionScreen.z >= -1 && positionScreen.z <= 1;
    }

    // 添加顶点
    pushVertex(x, y, z) {
        _vertex = getNextVertexInPool();
        _vertex.position.set(x, y, z);
        this.projectVertex(_vertex);
    }

    // 添加粒子
    pushPoint(_vector4, object, camera) {
        let invW = 1 / _vector4.w;
        _vector4.z *= invW;
        if (_vector4.z >= -1 && _vector4.z <= 1) {
            _sprite = getNextSpriteInPool();
            _sprite.id = object.id;
            _sprite.x = _vector4.x * invW;
            _sprite.y = _vector4.y * invW;
            _sprite.z = _vector4.z;
            _sprite.renderOrder = object.renderOrder;

            _sprite.rotation = object.rotation;
            _sprite.scale.x = object.scale.x * Math.abs(_sprite.x - (_vector4.x + camera.projectionMatrix.elements[0]) / (_vector4.w + camera.projectionMatrix.elements[12]));
            _sprite.scale.y = object.scale.y * Math.abs(_sprite.y - (_vector4.y + camera.projectionMatrix.elements[5]) / (_vector4.w + camera.projectionMatrix.elements[13]));
            _sprite.material = object.material;

            _renderData.elements.push(_sprite);
        }
    }

    checkTriangleVisibility(v1, v2, v3) {
        if (v1.visible === true || v2.visible === true || v3.visible === true) return true;

        _points3[0] = v1.positionScreen;
        _points3[1] = v2.positionScreen;
        _points3[2] = v3.positionScreen;

        return _clipBox.intersectsBox(_boundingBox.setFromPoints(_points3));
    }

    checkBackfaceCulling(v1, v2, v3) {
        return ((v3.positionScreen.x - v1.positionScreen.x) * (v2.positionScreen.y - v1.positionScreen.y) - (v3.positionScreen.y - v1.positionScreen.y) * (v2.positionScreen.x - v1.positionScreen.x)) < 0;
    }
}

let renderList = new RenderList();

class Projector {
    projectScene(scene, camera, sortObjects, sortElements) {
        let self = this;
        _objectCount = 0;
        _faceCount = 0;
        _renderData.elements = [];
        _renderData.objects = [];

        _viewMatrix.copy(camera.matrixWorldInverse);
        _viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, _viewMatrix);
        self.projectObject(scene);

        if (sortObjects === true) {
            _renderData.objects.sort(self.painterSort);
        }

        let objects = _renderData.objects;
        for (let o = 0; o < objects.length; o++) {
            let object = objects[o].object;
            let geometry = object.geometry;
            _vertexCount = 0;
            _modelMatrix = object.matrixWorld;
            if (object.isMesh) {
                let vertices = geometry.vertices;
                let faces = geometry.faces;

                let material = object.material;
                let isMultiMaterial = Array.isArray(material);

                // 点
                for (let v = 0; v < vertices.length; v++) {
                    let vertex = vertices[v];
                    _vector3.copy(vertex);
                    renderList.pushVertex(_vector3.x, _vector3.y, _vector3.z);
                }

                // 面
                for (let f = 0; f < faces.length; f++) {
                    material = isMultiMaterial === true ? object.material[face.materialIndex] : object.material;

                    let face = faces[f];
                    let v1 = _vertexPool[face.a];
                    let v2 = _vertexPool[face.b];
                    let v3 = _vertexPool[face.c];

                    if (renderList.checkTriangleVisibility(v1, v2, v3) === false) continue;
                    // 过滤面
                    if (renderList.checkBackfaceCulling(v1, v2, v3) === false) continue;

                    _face = getNextFaceInPool();

                    _face.id = object.id;
                    _face.color = face.color;
                    _face.material = material;

                    _face.v1.copy(v1);
                    _face.v2.copy(v2);
                    _face.v3.copy(v3);
                    _face.z = (v1.positionScreen.z + v2.positionScreen.z + v3.positionScreen.z) / 3;
                    _face.renderOrder = object.renderOrder;

                    _renderData.elements.push(_face);
                }
            }
            else if (object.isSprite) {
                _vector4.set(_modelMatrix.elements[12], _modelMatrix.elements[13], _modelMatrix.elements[14], 1);
                _vector4.applyMatrix4(_viewProjectionMatrix);
                renderList.pushPoint(_vector4, object, camera);
            }
        }

        if (sortElements === true) {
            _renderData.elements.sort(self.painterSort);
        }
        return _renderData;
    }

    projectObject(object) {
        let self = this;
        if (object.visible === false) return;
        if (object.isMesh) {
            self.pushObject(object);
        }
        else if (object.isSprite) {
            self.pushObject(object);
        }

        let children = object.children;
        for (let i = 0, l = children.length; i < l; i++) {
            self.projectObject(children[i]);
        }
    }

    // 添加object
    pushObject(object) {
        _object = getNextObjectInPool();
        _object.id = object.id;
        _object.object = object;

        _vector3.setFromMatrixPosition(object.matrixWorld);
        _vector3.applyMatrix4(_viewProjectionMatrix);
        _object.z = _vector3.z;
        _object.renderOrder = object.renderOrder;
        _renderData.objects.push(_object);
    }

    painterSort(a, b) {
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder;
        } else if (a.z !== b.z) {
            return b.z - a.z;
        } else if (a.id !== b.id) {
            return a.id - b.id;
        } else {
            return 0;
        }
    }
}

// Object
class RenderableObject {
    constructor() {
        this.id = 0;
        this.object = null;
        this.z = 0;
        this.renderOrder = 0;
    }
}

// Face3
class RenderableFace {
    constructor() {
        this.id = 0;

        this.v1 = new RenderableVertex();
        this.v2 = new RenderableVertex();
        this.v3 = new RenderableVertex();

        this.color = new MeshBasicMaterial();
        this.material = null;

        this.z = 0;
        this.renderOrder = 0;
    }
}

// 顶点
class RenderableVertex {
    constructor() {
        this.position = new Vector3();
        this.positionWorld = new Vector3();
        this.positionScreen = new Vector4();
    }

    copy(vertex) {
        this.position.copy(vertex.position);
        this.positionWorld.copy(vertex.positionWorld);
        this.positionScreen.copy(vertex.positionScreen);
    }
}

// 粒子
class RenderableSprite {
    constructor() {
        this.id = 0;
        this.object = null;

        this.x = 0;
        this.y = 0;
        this.z = 0;

        this.rotation = 0;
        this.scale = new Vector2();

        this.material = null;
        this.renderOrder = 0;
    }
}

function getNextObjectInPool() {
    if (_objectCount === _objectPool.length) {
        let object = new RenderableObject();
        _objectPool.push(object);
        _objectCount++;
        return object;
    }
    return _objectPool[_objectCount++];
}

function getNextVertexInPool() {
    if (_vertexCount === _vertexPool.length) {
        let vertex = new RenderableVertex();
        _vertexPool.push(vertex);
        _vertexCount++;
        return vertex;

    }
    return _vertexPool[_vertexCount++];
}

function getNextFaceInPool() {
    if (_faceCount === _facePool.length) {
        let face = new RenderableFace();
        _facePool.push(face);
        _faceCount++;
        return face;

    }
    return _facePool[_faceCount++];
}

function getNextSpriteInPool() {
    if (_spriteCount === _spritePool.length) {
        let sprite = new RenderableSprite();
        _spritePool.push(sprite);
        _spriteCount++;
        return sprite;
    }
    return _spritePool[_spriteCount++];
}

export {RenderableObject, RenderableFace, RenderableSprite, Projector};